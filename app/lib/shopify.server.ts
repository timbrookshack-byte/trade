import type { Sql } from "./db.server";
import { recomputeBundleStock } from "./products.server";
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
  rrp: number | null;
  components: { sku: string; quantity: number }[];
}

function graphqlUrl(domain: string) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // http for localhost so the sync is testable against a local mock.
  const scheme = clean.startsWith("localhost") || clean.startsWith("127.") ? "http" : "https";
  return `${scheme}://${clean}/admin/api/${API_VERSION}/graphql.json`;
}

function stripHtml(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function fetchBundles(domain: string, token: string): Promise<ShopifyBundle[]> {
  const bundles: ShopifyBundle[] = [];
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
      const components = (node.bundleComponents?.nodes ?? [])
        .map((c: any) => ({
          sku: String(c?.componentProduct?.variants?.nodes?.[0]?.sku ?? "").trim(),
          quantity: Math.max(1, Math.trunc(Number(c?.quantity) || 1)),
        }))
        .filter((c: { sku: string }) => c.sku);
      if (components.length === 0) continue; // not a bundle

      const variant = node.variants?.nodes?.[0];
      const sku = String(variant?.sku ?? "").trim() || `SHOPIFY-${String(node.id).split("/").pop()}`;
      const price = Number(variant?.price);
      bundles.push({
        sku,
        name: String(node.title ?? "").trim(),
        description: stripHtml(String(node.descriptionHtml ?? "")),
        category: String(node.productType ?? "").trim() || "Packages",
        image_url: String(node.featuredMedia?.preview?.image?.url ?? ""),
        rrp: Number.isFinite(price) && price > 0 ? price : null,
        components,
      });
    }

    if (!products.pageInfo.hasNextPage) break;
    cursor = products.pageInfo.endCursor;
  }
  return bundles.filter((b) => b.name);
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
    const bundles = await fetchBundles(settings.shopify_domain, settings.shopify_admin_token);

    let created = 0;
    let updated = 0;
    const now = new Date();

    for (const bundle of bundles) {
      const rows = (await db`
        INSERT INTO products (sku, source, name, category, description, image_url, rrp_reference, stock_synced_at)
        VALUES (${bundle.sku}, 'shopify', ${bundle.name}, ${bundle.category},
                ${bundle.description}, ${bundle.image_url}, ${bundle.rrp}, ${now})
        ON CONFLICT (sku) DO UPDATE SET
          name = CASE WHEN products.overrides ? 'name' THEN products.name ELSE EXCLUDED.name END,
          description = CASE WHEN products.overrides ? 'description' THEN products.description ELSE EXCLUDED.description END,
          category = EXCLUDED.category,
          image_url = EXCLUDED.image_url,
          rrp_reference = EXCLUDED.rrp_reference,
          stock_synced_at = EXCLUDED.stock_synced_at,
          discontinued_at = NULL,
          updated_at = now()
        WHERE products.source = 'shopify'
        RETURNING id, (xmax = 0) AS inserted
      `) as unknown as { id: number; inserted: boolean }[];
      const row = rows[0];
      if (!row) continue; // SKU collision with a non-shopify product — skip
      if (row.inserted) created++;
      else updated++;

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

    await recomputeBundleStock(db);

    await db`
      UPDATE sync_runs SET
        finished_at = now(), status = 'success',
        products_in_feed = ${bundles.length},
        created_count = ${created}, updated_count = ${updated},
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
}

/** Components of a bundle, joined to the portal catalogue (null name = SKU not in portal). */
export async function getBundleComponents(db: Sql, bundleId: number) {
  return db<BundleComponentRow[]>`
    SELECT bc.component_sku, bc.quantity,
           p.name, p.image_url, p.available_now,
           (p.discontinued_at IS NOT NULL) AS discontinued
    FROM bundle_components bc
    LEFT JOIN products p ON upper(p.sku) = upper(bc.component_sku)
    WHERE bc.bundle_id = ${bundleId}
    ORDER BY bc.position, bc.component_sku
  `;
}
