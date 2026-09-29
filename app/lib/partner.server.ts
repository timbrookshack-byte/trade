import type { AppLoadContext } from "react-router";
import type { Sql } from "./db.server";
import { LOW_STOCK_THRESHOLD } from "./stock";

/**
 * Partner product feed: read-only catalogue access for partners (e.g. a
 * trade customer listing our range on their own site), mirroring the shape
 * of 360's feed one level down.
 *
 * Security posture:
 * - Keys are random 128-hex-char tokens shown ONCE and stored as SHA-256
 *   hashes — a database leak doesn't leak keys.
 * - The feed exposes only what the PUBLIC storefront could see (active,
 *   non-discontinued, category not hidden) plus RRP and a stock BAND —
 *   never raw stock numbers, and never trade prices unless the key was
 *   explicitly created with include_trade_prices.
 */

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generatePartnerKey() {
  return "tpk_" + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export interface PartnerKey {
  id: number;
  label: string;
  include_trade_prices: boolean;
}

/** Resolve a presented token to an active key row (and stamp last_used_at). */
export async function authenticatePartner(db: Sql, token: string): Promise<PartnerKey | null> {
  if (!token.startsWith("tpk_")) return null;
  const hash = await sha256Hex(token);
  const [key] = await db<PartnerKey[]>`
    UPDATE partner_api_keys SET last_used_at = now()
    WHERE key_hash = ${hash} AND active
    RETURNING id, label, include_trade_prices
  `;
  return key ?? null;
}

/** Band + next ETA only — partners render their own wording. */
function partnerStock(available: number, incoming: { qty: number; eta: string }[]) {
  const eta =
    [...incoming]
      .filter((s) => s.eta)
      .sort((a, b) => a.eta.localeCompare(b.eta))[0]?.eta ?? null;
  if (available > LOW_STOCK_THRESHOLD) return { status: "in_stock", next_eta: eta };
  if (available > 0) return { status: "low_stock", next_eta: eta };
  if (incoming.length > 0) return { status: "incoming", next_eta: eta };
  return { status: "out_of_stock", next_eta: null };
}

export async function partnerProducts(context: AppLoadContext, key: PartnerKey) {
  const rows = await context.db<
    {
      sku: string;
      name: string;
      category: string;
      description: string;
      dimensions: string | null;
      image_url: string;
      images: string[];
      rrp_reference: string | null;
      trade_price: string | null;
      available_now: number;
      incoming: { qty: number; eta: string; status: string }[];
      stock_synced_at: string | null;
    }[]
  >`
    SELECT p.sku, p.name,
           COALESCE(NULLIF(cs.display_name, ''), p.category) AS category,
           p.description, p.dimensions, p.image_url, p.images,
           p.rrp_reference, p.trade_price, p.available_now, p.incoming,
           p.stock_synced_at::text AS stock_synced_at
    FROM products p
    LEFT JOIN category_settings cs ON cs.category = p.category
    WHERE p.active AND p.discontinued_at IS NULL
      AND COALESCE(cs.hidden, FALSE) = FALSE
    ORDER BY COALESCE(NULLIF(cs.display_name, ''), p.category), p.name
  `;
  return {
    generated_at: new Date().toISOString(),
    count: rows.length,
    products: rows.map((p) => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      description: p.description,
      dimensions: p.dimensions || "",
      images: p.images?.length ? p.images : p.image_url ? [p.image_url] : [],
      rrp_inc_gst: p.rrp_reference != null ? Number(p.rrp_reference) : null,
      // Trade prices only on keys explicitly created with them.
      ...(key.include_trade_prices
        ? { trade_price_inc_gst: p.trade_price != null ? Number(p.trade_price) : null }
        : {}),
      // A stock BAND, not warehouse numbers.
      stock: partnerStock(p.available_now, p.incoming ?? []),
      stock_as_at: p.stock_synced_at,
    })),
  };
}
