import type { Sql } from "./db.server";
import type { Product, ProductFilter } from "./products";

export async function listProducts(
  db: Sql,
  filter: ProductFilter,
  search: string,
  category = "",
) {
  const term = search.trim() ? `%${search.trim()}%` : null;
  const cat = category.trim() || null;
  return db<Product[]>`
    SELECT * FROM products
    WHERE CASE ${filter}
        WHEN 'active' THEN active AND discontinued_at IS NULL
        WHEN 'inactive' THEN NOT active AND discontinued_at IS NULL
        WHEN 'new' THEN source = 'shack360' AND NOT active AND trade_price IS NULL AND discontinued_at IS NULL
        WHEN 'bundles' THEN source = 'shopify'
        WHEN 'portal' THEN source = 'portal'
        WHEN 'discontinued' THEN discontinued_at IS NOT NULL
        ELSE TRUE
      END
      AND (${cat}::text IS NULL OR category = ${cat})
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
