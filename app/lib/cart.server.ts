import { createCookie, type AppLoadContext } from "react-router";

/** Signed cookie cart for trade customers: [{ sku, qty }]. */
export interface CartLine {
  sku: string;
  qty: number;
}

function cartCookie(env: Env) {
  return createCookie("__tp_cart", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: import.meta.env.PROD,
    secrets: [env.SESSION_SECRET],
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function readCart(context: AppLoadContext, request: Request): Promise<CartLine[]> {
  const parsed = await cartCookie(context.cloudflare.env).parse(request.headers.get("Cookie"));
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (l): l is CartLine =>
        l && typeof l.sku === "string" && Number.isInteger(l.qty) && l.qty > 0,
    )
    .slice(0, 100);
}

export async function serializeCart(context: AppLoadContext, lines: CartLine[]) {
  return cartCookie(context.cloudflare.env).serialize(lines);
}

export function addToCart(lines: CartLine[], sku: string, qty: number): CartLine[] {
  const existing = lines.find((l) => l.sku === sku);
  if (existing) {
    return lines.map((l) => (l.sku === sku ? { ...l, qty: Math.min(999, l.qty + qty) } : l));
  }
  return [...lines, { sku, qty: Math.min(999, qty) }];
}

/**
 * Bundle explosion: a Shopify bundle carts as its COMPONENT lines (real
 * SKUs × qty), so invoices show the pieces and the 360 push matches real
 * stock items instead of an unmatchable bundle SKU — same philosophy as
 * dining sets ("two REAL line items").
 *
 * Only when price-safe: every component must exist in the catalogue with a
 * trade price, not be discontinued, and the components must sum EXACTLY to
 * the bundle's advertised price (always true for default-priced bundles —
 * bundle pricing is computed as that sum). A manually-priced bundle whose
 * total differs keeps the old single-line behaviour rather than silently
 * charging a different amount; returns null for "don't explode".
 */
export async function bundleCartLines(
  context: AppLoadContext,
  bundle: { id: number; source: string; trade_price: string | null },
): Promise<CartLine[] | null> {
  if (bundle.source !== "shopify" || bundle.trade_price == null) return null;
  const components = await context.db<
    { sku: string; quantity: number; trade_price: string | null; unavailable: boolean }[]
  >`
    SELECT p.sku, bc.quantity, p.trade_price,
           (p.discontinued_at IS NOT NULL OR NOT p.active) AS unavailable
    FROM bundle_components bc
    LEFT JOIN products p ON upper(p.sku) = upper(bc.component_sku)
    WHERE bc.bundle_id = ${bundle.id}
  `;
  if (components.length === 0) return null;
  // The cart page only shows active, priced products — never cart a line
  // it would silently drop.
  if (components.some((c) => !c.sku || c.unavailable || c.trade_price == null)) return null;
  const sum = components.reduce(
    (total, c) => total + Math.round(Number(c.trade_price) * 100) * c.quantity,
    0,
  );
  if (sum !== Math.round(Number(bundle.trade_price) * 100)) return null;
  return components.map((c) => ({ sku: c.sku, qty: c.quantity }));
}
