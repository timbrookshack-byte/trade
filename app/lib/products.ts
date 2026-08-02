// Shared product types/constants — safe for both server and client code.
// Queries live in products.server.ts.

export interface Product {
  id: number;
  sku: string;
  source: "shack360" | "portal" | "shopify";
  name: string;
  category: string;
  description: string;
  dimensions: string;
  cbm: string | null;
  weight_kg: string | null;
  image_url: string;
  /** Gallery URLs (all Shopify images for SKU-matched/bundle products). */
  images: string[];
  store_link: string;
  rrp_reference: string | null;
  trade_price: string | null;
  active: boolean;
  available_now: number;
  incoming: { qty: number; eta: string; status: string }[];
  stock_synced_at: string | null;
  discontinued_at: string | null;
  overrides: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

export type ProductFilter =
  | "all"
  | "active"
  | "inactive"
  | "new"
  | "bundles"
  | "portal"
  | "discontinued";

export const PRODUCT_FILTERS: { key: ProductFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "new", label: "New from 360" },
  { key: "bundles", label: "Bundles" },
  { key: "portal", label: "Portal-only" },
  { key: "discontinued", label: "Discontinued" },
];
