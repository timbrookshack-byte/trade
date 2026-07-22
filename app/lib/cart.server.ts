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
