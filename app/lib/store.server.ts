import type { AppLoadContext } from "react-router";
import type { Product } from "./products";

/** Storefront queries — only active, non-discontinued products are visible. */

export interface CategoryTile {
  category: string;
  product_count: number;
  image_url: string | null;
}

// The storefront works in DISPLAY category names: raw 360 categories are
// mapped through category_settings (rename via display_name, hide via
// hidden). Admin screens keep working in raw 360 names.

export async function listCategories(context: AppLoadContext): Promise<CategoryTile[]> {
  return context.db<CategoryTile[]>`
    SELECT COALESCE(NULLIF(cs.display_name, ''), p.category) AS category,
           count(*) AS product_count,
           (ARRAY_REMOVE(ARRAY_AGG(NULLIF(p.image_url, '') ORDER BY p.available_now DESC), NULL))[1] AS image_url
    FROM products p
    LEFT JOIN category_settings cs ON cs.category = p.category
    WHERE p.active AND p.discontinued_at IS NULL AND p.category <> ''
      AND COALESCE(cs.hidden, FALSE) = FALSE
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function listStoreProducts(
  context: AppLoadContext,
  opts: { category?: string; search?: string },
) {
  const category = opts.category?.trim() || null;
  const term = opts.search?.trim() ? `%${opts.search.trim()}%` : null;
  return context.db<Product[]>`
    SELECT p.*, COALESCE(NULLIF(cs.display_name, ''), p.category) AS category
    FROM products p
    LEFT JOIN category_settings cs ON cs.category = p.category
    WHERE p.active AND p.discontinued_at IS NULL
      AND COALESCE(cs.hidden, FALSE) = FALSE
      AND (${category}::text IS NULL
           OR COALESCE(NULLIF(cs.display_name, ''), p.category) = ${category})
      AND (${term}::text IS NULL OR p.name ILIKE ${term} OR p.sku ILIKE ${term}
           OR COALESCE(NULLIF(cs.display_name, ''), p.category) ILIKE ${term})
    ORDER BY COALESCE(NULLIF(cs.display_name, ''), p.category), p.name
    LIMIT 1000
  `;
}

export async function getStoreProduct(context: AppLoadContext, sku: string) {
  const rows = await context.db<Product[]>`
    SELECT p.*, COALESCE(NULLIF(cs.display_name, ''), p.category) AS category
    FROM products p
    LEFT JOIN category_settings cs ON cs.category = p.category
    WHERE upper(p.sku) = upper(${sku}) AND p.active AND p.discontinued_at IS NULL
      AND COALESCE(cs.hidden, FALSE) = FALSE
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
