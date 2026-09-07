import type { Sql } from "./db.server";
import type { SyncResult } from "./sync.server";

/**
 * Dining set sync (see DSB export spec, mirrored in CLAUDE.md).
 *
 * In Shopify a dining set is a SHELL product (template dining-set*, never
 * carted) with `custom.dsb_*` metafields pointing at one table product and an
 * ordered list of `dining_set_chair_option` metaobjects (chair product +
 * composite hero image). The portal syncs that structure into dining_sets /
 * dining_set_chairs and resolves every product reference to variant SKUs —
 * pricing and stock then come from the portal catalogue (360 is the stock
 * truth; Shopify's availability metafields are ignored as derivative).
 *
 * The runtime (storefront configurator) adds the REAL table + chair SKUs to
 * the cart, so orders, invoices and the 360 push work natively.
 */

const API_VERSION = "2025-07";

interface VariantRef {
  sku: string;
  title: string;
}

interface ChairOption {
  handle: string;
  chairGid: string;
  heroUrl: string;
  tileUrl: string;
}

interface ShellRecord {
  slug: string;
  title: string;
  tableGid: string;
  chairOptionGids: string[];
  qtyOptions: number[];
  defaultQty: number;
  heroUrl: string;
}

function graphqlUrl(domain: string) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const scheme = clean.startsWith("localhost") || clean.startsWith("127.") ? "http" : "https";
  return `${scheme}://${clean}/admin/api/${API_VERSION}/graphql.json`;
}

async function gql(domain: string, token: string, query: string, variables: object) {
  const response = await fetch(graphqlUrl(domain), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Shopify API responded ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { data?: any; errors?: { message: string }[] };
  if (payload.errors?.length) throw new Error(`Shopify GraphQL error: ${payload.errors[0].message}`);
  if (!payload.data) throw new Error("Shopify response had no data.");
  return payload.data;
}

const SHELLS_QUERY = `
query DsbShells($cursor: String) {
  products(first: 100, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle templateSuffix
      tableProduct: metafield(namespace: "custom", key: "dsb_table_product") { value }
      chairOptions: metafield(namespace: "custom", key: "dsb_chair_options") { value }
      qtyOptions: metafield(namespace: "custom", key: "dsb_qty_options") { value }
      defaultQty: metafield(namespace: "custom", key: "dsb_default_qty") { value }
      defaultHero: metafield(namespace: "custom", key: "dsb_default_hero") {
        reference { ... on MediaImage { image { url } } }
      }
    }
  }
}`;

const CHAIR_OPTIONS_QUERY = `
query DsbChairOptions($cursor: String) {
  metaobjects(type: "dining_set_chair_option", first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle
      capabilities { publishable { status } }
      chair: field(key: "chair_product") { value }
      hero: field(key: "set_hero_image") { reference { ... on MediaImage { image { url } } } }
      tile: field(key: "tile_image") { reference { ... on MediaImage { image { url } } } }
    }
  }
}`;

const PRODUCT_NODES_QUERY = `
query DsbProducts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id title
      variants(first: 50) { nodes { sku title } }
    }
  }
}`;

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function fetchDiningData(domain: string, token: string) {
  // a. Shell products (template suffix dining-set*) with dsb_* metafields.
  const shells: ShellRecord[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data = await gql(domain, token, SHELLS_QUERY, { cursor });
    for (const node of data.products?.nodes ?? []) {
      const suffix = String(node.templateSuffix ?? "");
      const tableGid = String(node.tableProduct?.value ?? "").trim();
      // The durable join is the metafields, not the suffix (spec §7) — but
      // require both a dining template and a table reference to qualify.
      if (!suffix.startsWith("dining-set") || !tableGid) continue;
      const qtyOptions = String(node.qtyOptions?.value ?? "")
        .split(",")
        .map((v: string) => Math.trunc(Number(v.trim())))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      if (qtyOptions.length === 0) continue;
      const defaultQtyRaw = Math.trunc(Number(node.defaultQty?.value ?? 0));
      shells.push({
        slug: String(node.handle ?? "").trim(),
        title: String(node.title ?? "").trim(),
        tableGid,
        chairOptionGids: parseJsonArray(node.chairOptions?.value),
        qtyOptions,
        defaultQty: qtyOptions.includes(defaultQtyRaw) ? defaultQtyRaw : qtyOptions[0],
        heroUrl: String(node.defaultHero?.reference?.image?.url ?? ""),
      });
    }
    if (!data.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  // b. Chair-option metaobjects (ACTIVE only — DRAFT entries are dead data).
  const chairOptionsByGid = new Map<string, ChairOption>();
  cursor = null;
  for (let page = 0; page < 40; page++) {
    const data = await gql(domain, token, CHAIR_OPTIONS_QUERY, { cursor });
    for (const node of data.metaobjects?.nodes ?? []) {
      if (String(node.capabilities?.publishable?.status ?? "ACTIVE") !== "ACTIVE") continue;
      const chairGid = String(node.chair?.value ?? "").trim();
      if (!chairGid) continue;
      chairOptionsByGid.set(String(node.id), {
        handle: String(node.handle ?? "").trim(),
        chairGid,
        heroUrl: String(node.hero?.reference?.image?.url ?? ""),
        tileUrl: String(node.tile?.reference?.image?.url ?? ""),
      });
    }
    if (!data.metaobjects?.pageInfo?.hasNextPage) break;
    cursor = data.metaobjects.pageInfo.endCursor;
  }

  // c. Resolve every referenced table/chair product to its variant SKUs.
  const productGids = new Set<string>();
  for (const shell of shells) productGids.add(shell.tableGid);
  for (const option of chairOptionsByGid.values()) productGids.add(option.chairGid);
  const productsByGid = new Map<string, { title: string; variants: VariantRef[] }>();
  const gidList = [...productGids];
  for (let i = 0; i < gidList.length; i += 100) {
    const data = await gql(domain, token, PRODUCT_NODES_QUERY, {
      ids: gidList.slice(i, i + 100),
    });
    for (const node of data.nodes ?? []) {
      if (!node?.id) continue;
      const variants: VariantRef[] = (node.variants?.nodes ?? [])
        .map((v: any) => ({
          sku: String(v?.sku ?? "").trim(),
          title: String(v?.title ?? "").trim(),
        }))
        .filter((v: VariantRef) => v.sku);
      productsByGid.set(String(node.id), {
        title: String(node.title ?? "").trim(),
        variants,
      });
    }
  }

  return { shells, chairOptionsByGid, productsByGid };
}

export async function runDiningSetSync(db: Sql, trigger: "cron" | "manual"): Promise<SyncResult> {
  const settings = Object.fromEntries(
    (
      await db<{ key: string; value: string }[]>`
        SELECT key, value FROM settings WHERE key IN ('shopify_domain', 'shopify_admin_token')
      `
    ).map((r) => [r.key, r.value]),
  );
  if (!settings.shopify_domain || !settings.shopify_admin_token) {
    return { status: "error", error: "Shopify not configured — set it up in Settings." };
  }

  const [run] = await db<{ id: number }[]>`
    INSERT INTO sync_runs (trigger, kind) VALUES (${trigger}, 'dining_sets') RETURNING id
  `;

  try {
    const { shells, chairOptionsByGid, productsByGid } = await fetchDiningData(
      settings.shopify_domain,
      settings.shopify_admin_token,
    );

    let created = 0;
    let updated = 0;
    const seenSlugs: string[] = [];

    for (const shell of shells) {
      if (!shell.slug || !shell.title) continue;
      const table = productsByGid.get(shell.tableGid);
      if (!table || table.variants.length === 0) continue; // no orderable table

      const rows = (await db`
        INSERT INTO dining_sets (slug, title, table_product_title, table_skus,
                                 qty_options, default_qty, hero_image_url, synced_at)
        VALUES (${shell.slug}, ${shell.title}, ${table.title}, ${db.json(table.variants as unknown as import('postgres').JSONValue)},
                ${db.json(shell.qtyOptions)}, ${shell.defaultQty}, ${shell.heroUrl}, now())
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          table_product_title = EXCLUDED.table_product_title,
          table_skus = EXCLUDED.table_skus,
          qty_options = EXCLUDED.qty_options,
          default_qty = EXCLUDED.default_qty,
          hero_image_url = EXCLUDED.hero_image_url,
          discontinued_at = NULL,
          synced_at = now(),
          updated_at = now()
        RETURNING id, (xmax = 0) AS inserted
      `) as unknown as { id: number; inserted: boolean }[];
      const row = rows[0];
      if (!row) continue;
      if (row.inserted) created++;
      else updated++;
      seenSlugs.push(shell.slug);

      // Chair options: metafield order is display order (first = default).
      await db`DELETE FROM dining_set_chairs WHERE set_id = ${row.id}`;
      let position = 0;
      for (const gid of shell.chairOptionGids) {
        const option = chairOptionsByGid.get(gid);
        if (!option) continue; // DRAFT or vanished metaobject
        const chair = productsByGid.get(option.chairGid);
        if (!chair || chair.variants.length === 0) continue;
        await db`
          INSERT INTO dining_set_chairs (set_id, handle, chair_product_title, chair_skus,
                                         hero_image_url, tile_image_url, position)
          VALUES (${row.id}, ${option.handle || gid}, ${chair.title}, ${db.json(chair.variants as unknown as import('postgres').JSONValue)},
                  ${option.heroUrl}, ${option.tileUrl}, ${position++})
          ON CONFLICT (set_id, handle) DO NOTHING
        `;
      }
    }

    // Sets that vanished from Shopify: flag, never delete.
    const gone =
      seenSlugs.length > 0
        ? await db<{ slug: string }[]>`
            UPDATE dining_sets SET discontinued_at = now(), updated_at = now()
            WHERE discontinued_at IS NULL AND slug NOT IN ${db(seenSlugs)}
            RETURNING slug
          `
        : [];

    await db`
      UPDATE sync_runs SET finished_at = now(), status = 'success',
        products_in_feed = ${shells.length},
        created_count = ${created}, updated_count = ${updated},
        discontinued_count = ${gone.length}
      WHERE id = ${run.id}
    `;
    return {
      status: "success",
      productsInFeed: shells.length,
      created,
      updated,
      discontinued: gone.length,
    };
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (/access denied/i.test(message)) {
      message +=
        " — the Shopify token is missing the read_metaobjects/read_files scopes. " +
        "Add them to the app's Admin API scopes in Shopify first, then use " +
        '"Reconnect to Shopify" in Settings and run this sync again.';
    }
    await db`
      UPDATE sync_runs SET finished_at = now(), status = 'error', error = ${message}
      WHERE id = ${run.id}
    `;
    return { status: "error", error: message };
  }
}

// ---- Portal-side reads ----

export interface DiningSet {
  id: number;
  slug: string;
  title: string;
  table_product_title: string;
  table_skus: VariantRef[];
  qty_options: number[];
  default_qty: number;
  hero_image_url: string;
  active: boolean;
  discontinued_at: string | null;
  synced_at: string | null;
}

export interface DiningSetChair {
  id: number;
  set_id: number;
  handle: string;
  chair_product_title: string;
  chair_skus: VariantRef[];
  hero_image_url: string;
  tile_image_url: string;
  position: number;
}

export async function listDiningSets(db: Sql, opts: { activeOnly?: boolean } = {}) {
  return db<(DiningSet & { chair_count: number })[]>`
    SELECT s.*,
           (SELECT count(*) FROM dining_set_chairs c WHERE c.set_id = s.id)::int AS chair_count
    FROM dining_sets s
    WHERE ${opts.activeOnly ?? false} = FALSE OR (s.active AND s.discontinued_at IS NULL)
    ORDER BY s.title
  `;
}

export async function getDiningSet(db: Sql, slug: string) {
  const [set] = await db<DiningSet[]>`SELECT * FROM dining_sets WHERE slug = ${slug}`;
  if (!set) return null;
  const chairs = await db<DiningSetChair[]>`
    SELECT * FROM dining_set_chairs WHERE set_id = ${set.id} ORDER BY position, id
  `;
  return { set, chairs };
}

/**
 * The dining sets appear on the storefront as a CATEGORY tile ("Commercial
 * Outdoor Dining Sets") linking to /dining-sets, alongside the product
 * categories. A category_settings row with this raw name lets the team
 * rename/hide it or set a custom tile image, exactly like real categories.
 */
export const DINING_CATEGORY_NAME = "Commercial Outdoor Dining Sets";

export interface DiningCategoryTile {
  category: string;
  product_count: number;
  image_url: string | null;
  image_fit: "cover" | "contain";
  featured: boolean;
}

export async function getDiningCategoryTile(db: Sql): Promise<DiningCategoryTile | null> {
  const [row] = await db<
    {
      n: number;
      hero: string | null;
      display_name: string | null;
      hidden: boolean | null;
      image_url: string | null;
      image_fit: string | null;
      featured: boolean | null;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM dining_sets WHERE active AND discontinued_at IS NULL) AS n,
      (SELECT hero_image_url FROM dining_sets
        WHERE active AND discontinued_at IS NULL AND hero_image_url <> ''
        ORDER BY title LIMIT 1) AS hero,
      cs.display_name, cs.hidden, cs.image_url, cs.image_fit, cs.featured
    FROM (SELECT 1) one
    LEFT JOIN category_settings cs ON cs.category = ${DINING_CATEGORY_NAME}
  `;
  if (!row || row.n === 0 || row.hidden) return null;
  return {
    category: row.display_name?.trim() || DINING_CATEGORY_NAME,
    product_count: row.n,
    image_url: row.image_url?.trim() || row.hero || null,
    image_fit: row.image_fit === "contain" ? "contain" : "cover",
    featured: Boolean(row.featured),
  };
}
