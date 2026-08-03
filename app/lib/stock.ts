// Stock indicator logic shared by storefront components (client-safe).
// Trade customers see bands, not raw warehouse numbers, plus incoming ETAs —
// stock is cached from 360 and clearly timestamped, never promised real-time.

import type { Product } from "./products";

export const LOW_STOCK_THRESHOLD = 5;

export type StockStatus =
  | { kind: "in_stock"; label: string }
  | { kind: "low"; label: string }
  | { kind: "incoming"; label: string }
  | { kind: "out"; label: string };

function formatEtaDate(eta: string) {
  const date = new Date(eta);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function stockStatus(product: Product): StockStatus {
  if (product.source === "portal") {
    // Portal-only products have no 360 stock feed; treat as available.
    return { kind: "in_stock", label: "In stock" };
  }
  const incoming = [...(product.incoming ?? [])].sort((a, b) => a.eta.localeCompare(b.eta));
  if (product.available_now > LOW_STOCK_THRESHOLD) {
    return { kind: "in_stock", label: "In stock" };
  }
  if (product.available_now > 0) {
    const eta = incoming.length > 0 ? formatEtaDate(incoming[0].eta) : "";
    return {
      kind: "low",
      label: `Low stock — ${product.available_now} left${eta ? ` · more due ${eta}` : ""}`,
    };
  }
  if (incoming.length > 0) {
    const eta = formatEtaDate(incoming[0].eta);
    return { kind: "incoming", label: eta ? `Incoming — ETA ${eta}` : "Incoming" };
  }
  return { kind: "out", label: "Out of stock" };
}
