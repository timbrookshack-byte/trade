import type { AppLoadContext } from "react-router";
import type { Product } from "./products";

/** Storefront queries — only active, non-discontinued products are visible. */

export interface CategoryTile {
  category: string;
  product_count: number;
  image_url: string | null;
  image_fit: "cover" | "contain";
  featured: boolean;
}

// The storefront works in DISPLAY category names: raw 360 categories are
// mapped through category_settings (rename via display_name, hide via
// hidden). Admin screens keep working in raw 360 names.

export async function listCategories(context: AppLoadContext): Promise<CategoryTile[]> {
  // Each product counts under its primary category AND any extra_categories.
  // Tile photo prefers the Shopify gallery's first image (full-res) over
  // 360's low-res image_url.
  return context.db<CategoryTile[]>`
    SELECT COALESCE(NULLIF(cs.display_name, ''), pc.category) AS category,
           count(*) AS product_count,
           COALESCE(
             MAX(NULLIF(cs.image_url, '')),
             (ARRAY_REMOVE(ARRAY_AGG(
                COALESCE(NULLIF(pc.images->>0, ''), NULLIF(pc.image_url, ''))
                ORDER BY pc.available_now DESC), NULL))[1]
           ) AS image_url,
           -- 'contain' sorts before 'cover', so a merged tile fits the image
           -- if ANY of its mapped categories asks for fit.
           MIN(COALESCE(NULLIF(cs.image_fit, ''), 'cover')) AS image_fit,
           BOOL_OR(COALESCE(cs.featured, FALSE)) AS featured
    FROM (
      SELECT p.category, p.images, p.image_url, p.available_now
      FROM products p WHERE p.active AND p.discontinued_at IS NULL
      UNION ALL
      SELECT ec.value, p.images, p.image_url, p.available_now
      FROM products p, jsonb_array_elements_text(p.extra_categories) ec(value)
      WHERE p.active AND p.discontinued_at IS NULL
    ) pc
    LEFT JOIN category_settings cs ON cs.category = pc.category
    WHERE pc.category <> '' AND COALESCE(cs.hidden, FALSE) = FALSE
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
           OR COALESCE(NULLIF(cs.display_name, ''), p.category) = ${category}
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(p.extra_categories) ec(value)
             LEFT JOIN category_settings cs2 ON cs2.category = ec.value
             WHERE COALESCE(NULLIF(cs2.display_name, ''), ec.value) = ${category}
               AND COALESCE(cs2.hidden, FALSE) = FALSE
           ))
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

/** Visible products for a SKU list (project "shop the look"), in list order. */
export async function listProductsBySkus(context: AppLoadContext, skus: string[]) {
  if (skus.length === 0) return [];
  const db = context.db;
  const upper = skus.map((s) => s.toUpperCase());
  const rows = await db<Product[]>`
    SELECT p.*, COALESCE(NULLIF(cs.display_name, ''), p.category) AS category
    FROM products p
    LEFT JOIN category_settings cs ON cs.category = p.category
    WHERE upper(p.sku) IN ${db(upper)} AND p.active AND p.discontinued_at IS NULL
      AND COALESCE(cs.hidden, FALSE) = FALSE
  `;
  return upper
    .map((sku) => rows.find((r: Product) => r.sku.toUpperCase() === sku))
    .filter((r): r is Product => r != null);
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
