import type { Sql } from "./db.server";
import type { Product, ProductFilter } from "./products";

export async function listProducts(db: Sql, filter: ProductFilter, search: string) {
  const term = search.trim() ? `%${search.trim()}%` : null;
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
      AND (${term}::text IS NULL OR sku ILIKE ${term} OR name ILIKE ${term} OR category ILIKE ${term})
    ORDER BY category, name
    LIMIT 1000
  `;
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
