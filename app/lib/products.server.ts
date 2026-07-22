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
