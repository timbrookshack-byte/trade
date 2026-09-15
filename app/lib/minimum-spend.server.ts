import type { AppLoadContext } from "react-router";
import type { Sql } from "./db.server";
import { getSetting } from "./settings.server";
import { MINIMUM_SPEND_DEFAULT } from "./minimum-spend";
import { exGst } from "./utils";

export { MINIMUM_SPEND_DEFAULT, minimumSpendNotice } from "./minimum-spend";

/** Minimum first-order spend, ex GST. 0 (set in admin) turns the notice off. */
export async function getMinimumSpend(context: AppLoadContext) {
  const raw = await getSetting(context, "minimum_order_amount");
  if (raw == null || raw.trim() === "") return MINIMUM_SPEND_DEFAULT;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : MINIMUM_SPEND_DEFAULT;
}

/**
 * Has this customer ordered before? Quotes and cancelled orders don't count.
 * `beforeOrderId` limits the check to orders placed BEFORE that one, so an
 * order stays "the first order" once later ones exist.
 */
export async function hasPriorOrders(db: Sql, customerId: number | null, beforeOrderId?: number) {
  if (!customerId) return false;
  const [row] = await db<{ n: number }[]>`
    SELECT count(*)::int AS n FROM orders
    WHERE customer_id = ${customerId}
      AND status NOT IN ('quote', 'cancelled')
      AND (${beforeOrderId ?? null}::int IS NULL OR id < ${beforeOrderId ?? 0})
  `;
  return row.n > 0;
}

/**
 * The minimum-spend threshold to warn about for a cart/order, or null when no
 * notice applies — the threshold is off, the total clears it, or the customer
 * has ordered with us before. Compared ex GST, the way trade prices are quoted.
 * Pass `orderId` for a saved order (excludes it and anything later).
 */
export async function minimumSpendCheck(
  context: AppLoadContext,
  input: { customerId: number | null; totalIncGst: number; orderId?: number },
): Promise<number | null> {
  if (!(input.totalIncGst > 0)) return null;
  const minimum = await getMinimumSpend(context);
  if (minimum <= 0 || exGst(input.totalIncGst) >= minimum) return null;
  if (await hasPriorOrders(context.db, input.customerId, input.orderId)) return null;
  return minimum;
}
