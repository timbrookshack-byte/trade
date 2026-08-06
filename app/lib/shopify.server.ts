import type { Sql } from "./db.server";
import { applyStockAutoToggle, defaultTradePrice, recomputeBundleStock } from "./products.server";
import type { SyncResult } from "./sync.server";

/**
 * Shopify bundle sync. Pulls products built with the native Shopify Bundles
 * app (their component SKUs + quantities) via the Admin GraphQL API and
 * upserts them as portal products with source='shopify'. Same protection
 * rules as the 360 sync: trade_price and override-flagged copy are never
 * touched; vanished bundles get discontinued_at, not deleted.
 *
 * Setup (Shopify admin): Settings → Apps and sales channels → Develop apps →
 * create app with the read_products scope → install → copy the Admin API
 * access token (shpat_…) into portal Settings.
 */

const API_VERSION = "2025-07";
const PAGE_SIZE = 50;

interface ShopifyBundle {
  sku: string;
  name: string;
  description: string;
  category: string;
  image_url: string;
  images: string[];
  rrp: number | null;
  components: { sku: string; quantity: number }[];
}

function shopBaseUrl(domain: string) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // http for localhost so the sync is testable against a local mock.
  const scheme = clean.startsWith("localhost") || clean.startsWith("127.") ? "http" : "https";
  return `${scheme}://${clean}`;
}

function graphqlUrl(domain: string) {
  return `${shopBaseUrl(domain)}/admin/api/${API_VERSION}/graphql.json`;
}

// --- OAuth (new Shopify Dev Dashboard apps: client id + shpss_ client secret).
// The merchant clicks "Connect to Shopify" in Settings → approves in Shopify →
// the callback verifies the HMAC and exchanges the code for an offline access
// token, which is stored in settings.shopify_admin_token for the sync to use.

export function buildAuthorizeUrl(input: {
  domain: string;
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL(`${shopBaseUrl(input.domain)}/admin/oauth/authorize`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("scope", "read_products");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

/** Verify Shopify's callback HMAC: SHA-256 of the sorted query string, keyed by the client secret. */
export async function verifyCallbackHmac(searchParams: URLSearchParams, clientSecret: string) {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;
  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const expected = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== hmac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hmac.charCodeAt(i);
  return diff === 0;
}

export async function exchangeCodeForToken(input: {
  domain: string;
  clientId: string;
  clientSecret: string;
  code: string;
}) {
  const response = await fetch(`${shopBaseUrl(input.domain)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Token exchange returned no access token.");
  return payload.access_token;
}

/**
 * Shopify HTML → structured plain text. Preserves the copy's structure using
 * the conventions the storefront's RichText renderer understands: blank-line
 * paragraphs, "## " headings, "• " bullets. (Flattening everything to one
 * blob made product pages read like a wall of text.)
 */
function htmlToStructuredText(html: string) {
  let s = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  // A paragraph that is nothing but a short bold phrase is a pseudo-heading
  // (Shopify's editor produces these instead of real <h*> tags).
  s = s.replace(
    /<(p|div)[^>]*>\s*<(strong|b)[^>]*>\s*([^<]{1,80}?)\s*<\/\2>\s*:?\s*<\/\1>/gi,
    "\n\n## $3\n\n",
  );
  s = s.replace(/<h[1-6][^>]*>/gi, "\n\n## ");
  s = s.replace(/<\/h[1-6]>/gi, "\n\n");
  s = s.replace(/<li[^>]*>/gi, "\n• ");
  s = s.replace(/<\/(p|div|ul|ol|table|tr|blockquote)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&ndash;|&mdash;/gi, "—")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  s = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
  s = s.replace(/^## (.+?):$/gm, "## $1");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Retail warranty copy doesn't apply to trade — strip it from all imported
 * Shopify descriptions (bundles and SKU-matched items alike): any bullet or
 * paragraph line mentioning warranty, and a warranty heading together with
 * its entire section (until the next heading).
 */
function stripWarrantyCopy(text: string): string {
  const out: string[] = [];
  let inWarrantySection = false;
  for (const line of text.split("\n")) {
    if (/^##\s/.test(line)) {
      inWarrantySection = /warrant/i.test(line);
      if (inWarrantySection) continue;
    }
    if (inWarrantySection) continue;
    if (/warrant/i.test(line)) continue;
    out.push(line);
  }
  // Drop headings left with nothing under them (e.g. every line of their
  // section mentioned warranty).
  const cleaned = out.filter((line, i) => {
    if (!/^##\s/.test(line)) return true;
    const rest = out.slice(i + 1).find((l) => l.trim() !== "");
    return rest != null && !/^##\s/.test(rest);
  });
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const PRODUCTS_QUERY = `
query BundleProducts($cursor: String, $pageSize: Int!) {
  products(first: $pageSize, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      title
      status
      productType
      descriptionHtml
      featuredMedia { preview { image { url } } }
      media(first: 20) { nodes { preview { image { url } } } }
      variants(first: 1) { nodes { sku price } }
      bundleComponents(first: 40) {
        nodes {
          quantity
          componentProduct {
            variants(first: 1) { nodes { sku } }
          }
        }
      }
    }
  }
}`;

interface ShopifyEnrichment {
  sku: string;
  description: string;
  images: string[];
}

async function fetchBundles(
  domain: string,
  token: string,
): Promise<{ bundles: ShopifyBundle[]; enrichments: ShopifyEnrichment[] }> {
  const bundles: ShopifyBundle[] = [];
  const enrichments: ShopifyEnrichment[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 40; page++) {
    const response = await fetch(graphqlUrl(domain), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: PRODUCTS_QUERY,
        variables: { cursor, pageSize: PAGE_SIZE },
      }),
    });
    if (!response.ok) {
      throw new Error(`Shopify API responded ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as {
      data?: { products?: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: any[] } };
      errors?: { message: string }[];
    };
    if (payload.errors?.length) {
      throw new Error(`Shopify GraphQL error: ${payload.errors[0].message}`);
    }
    const products = payload.data?.products;
    if (!products) throw new Error("Shopify response had no products data.");

    for (const node of products.nodes) {
      if (node.status && node.status !== "ACTIVE") continue;
      const gallery: string[] = [
        ...new Set(
          (node.media?.nodes ?? [])
            .map((m: any) => String(m?.preview?.image?.url ?? "").trim())
            .filter(Boolean) as string[],
        ),
      ].slice(0, 20);
      const components = (node.bundleComponents?.nodes ?? [])
        .map((c: any) => ({
          sku: String(c?.componentProduct?.variants?.nodes?.[0]?.sku ?? "").trim(),
          quantity: Math.max(1, Math.trunc(Number(c?.quantity) || 1)),
        }))
        .filter((c: { sku: string }) => c.sku);

      if (components.length === 0) {
        // Not a bundle — but its richer Shopify copy and full image gallery
        // can enrich the matching 360-sourced product by SKU.
        const plainSku = String(node.variants?.nodes?.[0]?.sku ?? "").trim();
        const plainDesc = stripWarrantyCopy(htmlToStructuredText(String(node.descriptionHtml ?? "")));
        if (plainSku && (plainDesc || gallery.length > 0)) {
          enrichments.push({ sku: plainSku, description: plainDesc, images: gallery });
        }
        continue;
      }

      const variant = node.variants?.nodes?.[0];
      const sku = String(variant?.sku ?? "").trim() || `SHOPIFY-${String(node.id).split("/").pop()}`;
      const price = Number(variant?.price);
      bundles.push({
        sku,
        name: String(node.title ?? "").trim(),
        description: stripWarrantyCopy(htmlToStructuredText(String(node.descriptionHtml ?? ""))),
        category: String(node.productType ?? "").trim() || "Packages",
        image_url: String(node.featuredMedia?.preview?.image?.url ?? ""),
        images: gallery,
        rrp: Number.isFinite(price) && price > 0 ? price : null,
        components,
      });
    }

    if (!products.pageInfo.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }
  return { bundles: bundles.filter((b) => b.name), enrichments };
}

/**
 * SKU-match Shopify copy onto 360-sourced products. Marks the field as
 * overrides.description = "shopify" so the 360 sync stops touching it while
 * this sync keeps it fresh; a manual admin edit (overrides.description =
 * true) always wins and is never clobbered here.
 */
async function applyShopifyDescriptions(db: Sql, enrichments: ShopifyEnrichment[]) {
  let updated = 0;
  const withDesc = enrichments.filter((e) => e.description);
  for (let i = 0; i < withDesc.length; i += 100) {
    const chunk = withDesc.slice(i, i + 100).map((d) => [d.sku, d.description]);
    const rows = await db<{ id: number }[]>`
      UPDATE products p SET
        description = d.description,
        overrides = p.overrides || '{"description": "shopify"}'::jsonb,
        updated_at = now()
      FROM (VALUES ${db(chunk)}) AS d(sku, description)
      WHERE p.source = 'shack360'
        AND upper(p.sku) = upper(d.sku)
        AND (NOT p.overrides ? 'description' OR p.overrides->>'description' = 'shopify')
        AND p.description IS DISTINCT FROM d.description
      RETURNING p.id
    `;
    updated += rows.length;
  }
  return updated;
}

/**
 * SKU-match full Shopify image galleries onto 360-sourced products. The
 * gallery is Shopify-maintained data (like stock), not editable copy — no
 * overrides involved; each sync keeps it fresh. 360's own image_url stays
 * the primary photo everywhere.
 */
async function applyShopifyImages(db: Sql, enrichments: ShopifyEnrichment[]) {
  let updated = 0;
  const withImages = enrichments.filter((e) => e.images.length > 0);
  for (const e of withImages) {
    const rows = await db<{ id: number }[]>`
      UPDATE products SET images = ${db.json(e.images)}, updated_at = now()
      WHERE source = 'shack360'
        AND upper(sku) = upper(${e.sku})
        -- db.json here too: a plain string param double-encodes to a jsonb
        -- *string* and the guard never matches (CLAUDE.md jsonb rule).
        AND images IS DISTINCT FROM ${db.json(e.images)}::jsonb
      RETURNING id
    `;
    updated += rows.length;
  }
  return updated;
}

export async function runShopifyBundleSync(
  db: Sql,
  trigger: "cron" | "manual",
): Promise<SyncResult> {
  const settings = Object.fromEntries(
    (
      await db<{ key: string; value: string }[]>`
        SELECT key, value FROM settings WHERE key IN ('shopify_domain', 'shopify_admin_token')
      `
    ).map((r) => [r.key, r.value]),
  );
  if (!settings.shopify_domain || !settings.shopify_admin_token) {
    return {
      status: "error",
      error: "Shopify shop domain or admin token not configured — set them in Settings.",
    };
  }

  const [run] = await db<{ id: number }[]>`
    INSERT INTO sync_runs (trigger, kind) VALUES (${trigger}, 'shopify_bundles') RETURNING id
  `;

  try {
    const { bundles, enrichments } = await fetchBundles(
      settings.shopify_domain,
      settings.shopify_admin_token,
    );

    let created = 0;
    let updated = 0;
    const now = new Date();
    const [discountRow] = await db<{ value: string }[]>`
      SELECT value FROM settings WHERE key = 'trade_discount_percent'
    `;
    const discountPercent = Number(discountRow?.value) || 37.5;

    for (const bundle of bundles) {
      const rows = (await db`
        INSERT INTO products (sku, source, name, category, description, image_url, images, rrp_reference, stock_synced_at)
        VALUES (${bundle.sku}, 'shopify', ${bundle.name}, ${bundle.category},
                ${bundle.description}, ${bundle.image_url}, ${db.json(bundle.images)}, ${bundle.rrp}, ${now})
        ON CONFLICT (sku) DO UPDATE SET
          name = CASE WHEN products.overrides ? 'name' THEN products.name ELSE EXCLUDED.name END,
          description = CASE WHEN products.overrides ? 'description' THEN products.description ELSE EXCLUDED.description END,
          category = CASE WHEN products.overrides ? 'category' THEN products.category ELSE EXCLUDED.category END,
          image_url = EXCLUDED.image_url,
          images = EXCLUDED.images,
          rrp_reference = EXCLUDED.rrp_reference,
          stock_synced_at = EXCLUDED.stock_synced_at,
          discontinued_at = NULL,
          updated_at = now()
        WHERE products.source = 'shopify'
        RETURNING id, (xmax = 0) AS inserted
      `) as unknown as { id: number; inserted: boolean }[];
      const row = rows[0];
      if (!row) continue; // SKU collision with a non-shopify product — skip
      if (row.inserted) {
        created++;
        // NEW bundles go live by default: priced at the default trade formula
        // (Shopify price − trade discount) and active — the stock auto-toggle
        // below pulls them straight back off if components are short. The
        // team can reprice/deactivate any time; sync never touches either
        // again after this.
        if (bundle.rrp != null) {
          await db`
            UPDATE products
            SET trade_price = ${defaultTradePrice(bundle.rrp, discountPercent)}, active = TRUE
            WHERE id = ${row.id}
          `;
        }
      } else updated++;

      await db`DELETE FROM bundle_components WHERE bundle_id = ${row.id}`;
      for (let i = 0; i < bundle.components.length; i++) {
        const c = bundle.components[i];
        await db`
          INSERT INTO bundle_components (bundle_id, component_sku, quantity, position)
          VALUES (${row.id}, ${c.sku}, ${c.quantity}, ${i})
          ON CONFLICT (bundle_id, component_sku)
            DO UPDATE SET quantity = bundle_components.quantity + EXCLUDED.quantity
        `;
      }
    }

    const skus = bundles.map((b) => b.sku);
    const gone =
      skus.length > 0
        ? await db<{ sku: string }[]>`
            UPDATE products SET discontinued_at = now(), updated_at = now()
            WHERE source = 'shopify' AND discontinued_at IS NULL AND sku NOT IN ${db(skus)}
            RETURNING sku
          `
        : await db<{ sku: string }[]>`
            UPDATE products SET discontinued_at = now(), updated_at = now()
            WHERE source = 'shopify' AND discontinued_at IS NULL
            RETURNING sku
          `;

    const descriptionsApplied = await applyShopifyDescriptions(db, enrichments);
    const imagesApplied = await applyShopifyImages(db, enrichments);
    await recomputeBundleStock(db);
    await applyStockAutoToggle(db);

    await db`
      UPDATE sync_runs SET
        finished_at = now(), status = 'success',
        products_in_feed = ${bundles.length},
        created_count = ${created},
        updated_count = ${updated + descriptionsApplied + imagesApplied},
        discontinued_count = ${gone.length}
      WHERE id = ${run.id}
    `;
    return {
      status: "success",
      productsInFeed: bundles.length,
      created,
      updated,
      discontinued: gone.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db`
      UPDATE sync_runs SET finished_at = now(), status = 'error', error = ${message}
      WHERE id = ${run.id}
    `;
    return { status: "error", error: message };
  }
}

/** Cron wrapper: silently skip when Shopify isn't configured or the interval hasn't elapsed. */
export async function runScheduledShopifySync(db: Sql): Promise<SyncResult> {
  const configured = await db`
    SELECT 1 FROM settings
    WHERE key IN ('shopify_domain', 'shopify_admin_token') AND value <> ''
  `;
  if (configured.length < 2) return { status: "skipped" };

  const [intervalRow] = await db<{ value: string }[]>`
    SELECT value FROM settings WHERE key = 'stock_sync_minutes'
  `;
  const intervalMinutes = Math.max(5, Number(intervalRow?.value) || 30);
  const [last] = await db<{ started_at: string }[]>`
    SELECT started_at FROM sync_runs
    WHERE status = 'success' AND kind = 'shopify_bundles'
    ORDER BY started_at DESC LIMIT 1
  `;
  if (last) {
    const elapsedMs = Date.now() - new Date(last.started_at).getTime();
    if (elapsedMs < (intervalMinutes - 2) * 60_000) return { status: "skipped" };
  }
  return runShopifyBundleSync(db, "cron");
}

export interface BundleComponentRow {
  component_sku: string;
  quantity: number;
  name: string | null;
  image_url: string | null;
  available_now: number | null;
  discontinued: boolean | null;
  trade_price: string | null;
}

/** Components of a bundle, joined to the portal catalogue (null name = SKU not in portal). */
export async function getBundleComponents(db: Sql, bundleId: number) {
  return db<BundleComponentRow[]>`
    SELECT bc.component_sku, bc.quantity,
           p.name, p.image_url, p.available_now, p.trade_price,
           (p.discontinued_at IS NOT NULL) AS discontinued
    FROM bundle_components bc
    LEFT JOIN products p ON upper(p.sku) = upper(bc.component_sku)
    WHERE bc.bundle_id = ${bundleId}
    ORDER BY bc.position, bc.component_sku
  `;
}
