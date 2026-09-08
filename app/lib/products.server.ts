import type { Sql } from "./db.server";
import type { Product, ProductFilter } from "./products";

export async function listProducts(
  db: Sql,
  filter: ProductFilter,
  search: string,
  category = "",
  discountPercent = 37.5,
) {
  const term = search.trim() ? `%${search.trim()}%` : null;
  const cat = category.trim() || null;
  // 'off-default': 360 products whose trade price no longer matches the
  // formula — e.g. it was set while the feed's RRP was a promo price.
  // Bundles are excluded (their pricing recomputes from components).
  const factor = 1 - discountPercent / 100;
  return db<Product[]>`
    SELECT * FROM products
    WHERE CASE ${filter}
        WHEN 'active' THEN active AND discontinued_at IS NULL
        WHEN 'inactive' THEN NOT active AND discontinued_at IS NULL
        WHEN 'new' THEN source = 'shack360' AND NOT active AND trade_price IS NULL AND discontinued_at IS NULL
        WHEN 'bundles' THEN source = 'shopify'
        WHEN 'portal' THEN source = 'portal'
        WHEN 'off-default' THEN source = 'shack360' AND discontinued_at IS NULL
          AND rrp_reference IS NOT NULL AND trade_price IS NOT NULL
          AND trade_price IS DISTINCT FROM round((rrp_reference * ${factor})::numeric, 2)
        WHEN 'discontinued' THEN discontinued_at IS NOT NULL
        ELSE TRUE
      END
      AND (${cat}::text IS NULL OR category = ${cat} OR extra_categories ? ${cat})
      AND (${term}::text IS NULL OR sku ILIKE ${term} OR name ILIKE ${term} OR category ILIKE ${term})
    ORDER BY category, name
    LIMIT 1000
  `;
}

export async function listAllCategories(db: Sql) {
  const rows = await db<{ category: string }[]>`
    SELECT DISTINCT category FROM products WHERE category <> '' ORDER BY category
  `;
  return rows.map((r) => r.category);
}

/**
 * Default trade price (stored inc GST) from the 360 RRP:
 * RRP − discount% (default 37.5). Ex-GST is always derived (÷ 1.1), so
 * "RRP − 37.5% then ÷11×10" gives the ex figure the team quotes.
 */
export function defaultTradePrice(rrpIncGst: number, discountPercent: number) {
  return Math.round(rrpIncGst * (1 - discountPercent / 100) * 100) / 100;
}

/**
 * The stock rule, applied after every sync (360 products AND Shopify bundles,
 * whose available_now is computed from components): zero on hand and nothing
 * incoming → off the storefront, flagged auto_deactivated. Only the sync's own
 * deactivations reactivate when stock returns — manual ones never do.
 */
export async function applyStockAutoToggle(db: Sql) {
  const deactivated = await db<{ sku: string }[]>`
    UPDATE products SET active = FALSE, auto_deactivated = TRUE, updated_at = now()
    WHERE source IN ('shack360', 'shopify') AND active AND discontinued_at IS NULL
      AND available_now <= 0
      AND (incoming IS NULL OR jsonb_array_length(incoming) = 0)
    RETURNING sku
  `;
  const reactivated = await db<{ sku: string }[]>`
    UPDATE products SET active = TRUE, auto_deactivated = FALSE, updated_at = now()
    WHERE source IN ('shack360', 'shopify') AND NOT active AND auto_deactivated
      AND discontinued_at IS NULL AND trade_price IS NOT NULL
      AND (available_now > 0 OR jsonb_array_length(incoming) > 0)
    RETURNING sku
  `;
  if (deactivated.length > 0 || reactivated.length > 0) {
    console.log(
      `stock auto-toggle: ${deactivated.length} deactivated, ${reactivated.length} reactivated`,
    );
  }
  return { deactivated: deactivated.length, reactivated: reactivated.length };
}

/** Set the default trade price on every unpriced 360 product. Returns count. */
export async function applyDefaultPricing(db: Sql, discountPercent: number) {
  const rows = await db<{ id: number }[]>`
    UPDATE products
    SET trade_price = round(rrp_reference * ${1 - discountPercent / 100}, 2),
        updated_at = now()
    WHERE source = 'shack360'
      AND trade_price IS NULL
      AND rrp_reference IS NOT NULL
      AND discontinued_at IS NULL
    RETURNING id
  `;
  return rows.length;
}

/**
 * Recompute cached stock for Shopify bundles from their components' cached
 * Bundle pricing is computed from components: RRP = components at full RRP,
 * trade price = components at their trade prices (each already carrying the
 * trade discount). Skipped when any component is missing a trade price, or
 * when the team has manually priced the bundle (overrides.trade_price).
 * Called after every sync, like bundle stock.
 */
export async function recomputeBundlePricing(db: Sql) {
  const rows = await db<{ sku: string }[]>`
    UPDATE products b SET
      trade_price = round(c.trade_sum::numeric, 2),
      rrp_reference = CASE WHEN c.rrp_complete THEN round(c.rrp_sum::numeric, 2)
                           ELSE b.rrp_reference END,
      updated_at = now()
    FROM (
      SELECT bc.bundle_id,
             SUM(bc.quantity * p.trade_price) AS trade_sum,
             SUM(bc.quantity * p.rrp_reference) AS rrp_sum,
             bool_and(p.trade_price IS NOT NULL) AS trade_complete,
             bool_and(p.rrp_reference IS NOT NULL) AS rrp_complete
      FROM bundle_components bc
      LEFT JOIN products p ON upper(p.sku) = upper(bc.component_sku)
      GROUP BY bc.bundle_id
    ) c
    WHERE b.id = c.bundle_id AND b.source = 'shopify'
      AND NOT (b.overrides ? 'trade_price')
      AND c.trade_complete
      AND (b.trade_price IS DISTINCT FROM round(c.trade_sum::numeric, 2)
           OR (c.rrp_complete AND b.rrp_reference IS DISTINCT FROM round(c.rrp_sum::numeric, 2)))
    RETURNING b.sku
  `;
  if (rows.length > 0) console.log(`bundle pricing recomputed for ${rows.length} bundle(s)`);
  return rows.length;
}

/**
 * 360 stock: min(floor(component available / qty)); 0 if any component is
 * missing from the portal or discontinued. Called after every sync.
 */
export async function recomputeBundleStock(db: Sql) {
  await db`
    UPDATE products b
    SET available_now = COALESCE(sub.avail, 0)
    FROM (
      SELECT bc.bundle_id,
             MIN(
               CASE
                 WHEN c.id IS NULL OR c.discontinued_at IS NOT NULL THEN 0
                 ELSE FLOOR(c.available_now / bc.quantity)
               END
             )::int AS avail
      FROM bundle_components bc
      LEFT JOIN products c ON upper(c.sku) = upper(bc.component_sku)
      GROUP BY bc.bundle_id
    ) sub
    WHERE b.id = sub.bundle_id AND b.source = 'shopify'
  `;
}

/** Activate every priced, inactive, non-discontinued product. Returns count. */
export async function activatePriced(db: Sql) {
  const rows = await db<{ id: number }[]>`
    UPDATE products
    SET active = TRUE, updated_at = now()
    WHERE NOT active AND trade_price IS NOT NULL AND discontinued_at IS NULL
    RETURNING id
  `;
  return rows.length;
}

export async function getProduct(db: Sql, id: number) {
  const rows = await db<Product[]>`SELECT * FROM products WHERE id = ${id}`;
  return rows[0] ?? null;
}

/**
 * Optimistic-concurrency stamp for the product edit form: a hash of ONLY the
 * fields that form edits. Deliberately excludes stock/sync bookkeeping so the
 * 15-minute stock sync never triggers a false "changed while you were editing"
 * conflict — only a real edit to the same fields does (including a sync
 * refreshing the description).
 */
export async function productEditStamp(p: {
  sku: string;
  name: string;
  description: string;
  category: string;
  trade_price: string | null;
  active: boolean;
  extra_categories: string[];
  dimensions?: string | null;
  image_url?: string | null;
}) {
  const data = JSON.stringify([
    p.sku,
    p.name,
    p.description,
    p.category,
    p.trade_price,
    p.active,
    p.extra_categories,
    p.dimensions ?? "",
    p.image_url ?? "",
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function countNewFrom360(db: Sql) {
  const [row] = await db<{ count: number }[]>`
    SELECT count(*) FROM products
    WHERE source = 'shack360' AND NOT active AND trade_price IS NULL AND discontinued_at IS NULL
  `;
  return row.count;
}

/** Active lines whose cached 360 stock is at or below the threshold. */
export async function countLowStock(db: Sql, threshold = 5) {
  const [row] = await db<{ count: number }[]>`
    SELECT count(*) FROM products
    WHERE active AND discontinued_at IS NULL AND source = 'shack360'
      AND available_now <= ${threshold}
  `;
  return row.count;
}
