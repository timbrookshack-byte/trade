import type { AppLoadContext } from "react-router";
import type { Product } from "./products";

/** Storefront queries — only active, non-discontinued products are visible. */

export interface CategoryTile {
  category: string;
  product_count: number;
  image_url: string | null;
}

export async function listCategories(context: AppLoadContext): Promise<CategoryTile[]> {
  return context.db<CategoryTile[]>`
    SELECT category,
           count(*) AS product_count,
           (ARRAY_REMOVE(ARRAY_AGG(NULLIF(image_url, '') ORDER BY available_now DESC), NULL))[1] AS image_url
    FROM products
    WHERE active AND discontinued_at IS NULL AND category <> ''
    GROUP BY category
    ORDER BY category
  `;
}

export async function listStoreProducts(
  context: AppLoadContext,
  opts: { category?: string; search?: string },
) {
  const category = opts.category?.trim() || null;
  const term = opts.search?.trim() ? `%${opts.search.trim()}%` : null;
  return context.db<Product[]>`
    SELECT * FROM products
    WHERE active AND discontinued_at IS NULL
      AND (${category}::text IS NULL OR category = ${category})
      AND (${term}::text IS NULL OR name ILIKE ${term} OR sku ILIKE ${term} OR category ILIKE ${term})
    ORDER BY category, name
    LIMIT 1000
  `;
}

export async function getStoreProduct(context: AppLoadContext, sku: string) {
  const rows = await context.db<Product[]>`
    SELECT * FROM products
    WHERE upper(sku) = upper(${sku}) AND active AND discontinued_at IS NULL
  `;
  return rows[0] ?? null;
}

/**
 * Strip trade-only data before loader data reaches an unapproved visitor.
 * Loader payloads are serialised into the HTML, so hiding prices in the UI is
 * NOT enough — trade prices must never be in client-side JS (golden rule).
 */
export function scrubProductForPublic(product: Product): Product {
  return {
    ...product,
    trade_price: null,
    rrp_reference: null,
    available_now: 0,
    incoming: [],
    stock_synced_at: null,
    overrides: {},
  };
}
