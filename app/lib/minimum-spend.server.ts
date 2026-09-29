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
 * Is this an established trade customer rather than a new sign-up? True when
 * any of these hold:
 *
 *  - `existing_client` — everyone migrated from the old ordering system, and
 *    anyone the team marks by hand on the customers page;
 *  - an old-portal last-order date captured by the CSV import;
 *  - an order already placed through this portal (quotes and cancelled
 *    orders don't count). `beforeOrderId` limits that to orders placed
 *    BEFORE the one being checked, so an order stays "the first order" once
 *    later ones exist.
 *
 * Portal order history alone was the original test, which read every migrated
 * customer as brand new — they'd traded with us for years, just not here.
 */
export async function isExistingClient(db: Sql, customerId: number | null, beforeOrderId?: number) {
  if (!customerId) return false;
  const [row] = await db<{ existing: boolean }[]>`
    SELECT (c.existing_client
            OR c.last_order_external IS NOT NULL
            OR EXISTS (
              SELECT 1 FROM orders o
              WHERE o.customer_id = c.id
                AND o.status NOT IN ('quote', 'cancelled')
                AND (${beforeOrderId ?? null}::int IS NULL OR o.id < ${beforeOrderId ?? 0})
            )) AS existing
    FROM customers c
    WHERE c.id = ${customerId}
  `;
  return row?.existing ?? false;
}

/**
 * The minimum-spend threshold to warn about for a cart/order, or null when no
 * notice applies — the threshold is off, the total clears it, or this is an
 * established client rather than a new sign-up. Compared ex GST, the way trade
 * prices are quoted. Pass `orderId` for a saved order (excludes it and
 * anything later).
 */
export async function minimumSpendCheck(
  context: AppLoadContext,
  input: { customerId: number | null; totalIncGst: number; orderId?: number },
): Promise<number | null> {
  if (!(input.totalIncGst > 0)) return null;
  const minimum = await getMinimumSpend(context);
  if (minimum <= 0 || exGst(input.totalIncGst) >= minimum) return null;
  if (await isExistingClient(context.db, input.customerId, input.orderId)) return null;
  return minimum;
}
