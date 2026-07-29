import type { AppLoadContext } from "react-router";
import type { Sql } from "./db.server";
import type { Order, OrderItem, OrderStatus } from "./orders";
import { refreshOrderTotal } from "./orders.server";
import { emailTemplates, queueEmail } from "./email.server";
import { getPaymentInfo } from "./payment.server";
import { deliveryMethodLabel } from "./orders";

/**
 * Phase-2 orders integration (CLAUDE.md "Phase-2 orders contract").
 *
 * Flow: a submitted portal order is PUSHED to 360 as an unconfirmed quote in
 * the Trade branch; the team edits + confirms it in 360; the portal MIRRORS
 * 360's version back (lines, freight, status) so the customer's order page and
 * invoice always show the corrected truth. 360 masters a pushed order.
 *
 * Everything is gated by settings `orders_360_enabled = 'true'` — until the
 * 360 side ships and the flag is turned on, orders behave exactly as phase 1.
 */

interface Orders360Config {
  enabled: boolean;
  base: string; // e.g. https://shack360.app/api/trade/orders
  token: string;
}

interface Sale360 {
  sale_number: string;
  /** 360: confirming a quote creates a successor invoice; GET follows the
   * conversion and reports the live sale here. The portal adopts it. */
  current_sale_number?: string;
  portal_order_ref?: string;
  status?: string;
  lines?: { sku?: string | null; name?: string; qty?: number; unit_price_inc_gst?: number }[];
  total_inc_gst?: number;
  amount_paid?: number;
  balance_due?: number;
  updated_at?: string;
}

export async function get360OrdersConfig(db: Sql): Promise<Orders360Config> {
  const rows = await db<{ key: string; value: string }[]>`
    SELECT key, value FROM settings
    WHERE key IN ('trade_api_url', 'trade_api_token', 'orders_360_enabled')
  `;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const base = (s.trade_api_url ?? "").replace(/\/products\/?$/, "") + "/orders";
  return {
    enabled: s.orders_360_enabled === "true" && Boolean(s.trade_api_url) && Boolean(s.trade_api_token),
    base,
    token: s.trade_api_token ?? "",
  };
}

async function api360(config: Orders360Config, path: string, init?: RequestInit) {
  const response = await fetch(`${config.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`360 orders API ${init?.method ?? "GET"} ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Push a submitted order to 360 as an unconfirmed quote. Idempotent: skips if
 * the order already has a sale number (and 360 dedupes on portal_order_ref).
 * Never throws — failures land in orders.sync_360_error and the cron retries.
 */
export async function pushOrderTo360(db: Sql, orderId: number): Promise<{ ok: boolean; error?: string }> {
  const config = await get360OrdersConfig(db);
  if (!config.enabled) return { ok: false, error: "360 orders integration is not enabled." };

  const [order] = await db<Order[]>`SELECT * FROM orders WHERE id = ${orderId}`;
  if (!order) return { ok: false, error: "Order not found." };
  if (order.sale_number_360) return { ok: true };
  if (order.status !== "submitted") return { ok: false, error: "Only submitted orders are pushed." };

  const items = await db<OrderItem[]>`
    SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY position, id
  `;
  const components = await db<{ bundle_id: number; component_sku: string; quantity: number }[]>`
    SELECT bundle_id, component_sku, quantity FROM bundle_components
    WHERE bundle_id IN (SELECT COALESCE(product_id, -1) FROM order_items WHERE order_id = ${orderId})
  `;

  try {
    const payload = {
      portal_order_ref: order.order_number,
      customer: {
        business_name: order.business_name,
        contact_name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
        delivery_method: deliveryMethodLabel(order.delivery_method),
        delivery_address: order.delivery_address,
        urgent_date: order.urgent_date,
      },
      note: order.note,
      lines: items.map((i) => {
        const comps = components.filter((c) => c.bundle_id === i.product_id);
        return {
          sku: i.sku,
          name: i.name,
          qty: i.quantity,
          unit_price_inc_gst: Number(i.unit_price_inc_gst),
          ...(comps.length > 0
            ? { components: comps.map((c) => ({ sku: c.component_sku, qty: c.quantity })) }
            : {}),
        };
      }),
    };
    const sale = (await api360(config, "", {
      method: "POST",
      body: JSON.stringify(payload),
    })) as Sale360;
    if (!sale.sale_number) throw new Error("360 returned no sale_number");
    await db`
      UPDATE orders SET sale_number_360 = ${sale.sale_number}, pushed_to_360_at = now(),
        sync_360_error = NULL, updated_at = now()
      WHERE id = ${orderId}
    `;
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db`UPDATE orders SET sync_360_error = ${message}, updated_at = now() WHERE id = ${orderId}`;
    return { ok: false, error: message };
  }
}

/** Portal ranks — the mirror only ever moves an order forward (or cancels). */
const STATUS_RANK: Record<OrderStatus, number> = {
  quote: 0,
  submitted: 1,
  confirmed: 2,
  picking: 3,
  dispatched: 4,
  completed: 5,
  cancelled: 99,
};

/**
 * Mirror a pushed order from 360: replace lines wholesale (360 masters them)
 * and advance the status. Sends the confirmed/dispatched emails on mirrored
 * transitions, same as manual ones. Never throws.
 */
export async function pullOrderFrom360(
  context: AppLoadContext,
  orderId: number,
): Promise<{ ok: boolean; changed?: boolean; error?: string }> {
  const db = context.db;
  const config = await get360OrdersConfig(db);
  if (!config.enabled) return { ok: false, error: "360 orders integration is not enabled." };

  const [order] = await db<Order[]>`SELECT * FROM orders WHERE id = ${orderId}`;
  if (!order?.sale_number_360) return { ok: false, error: "Order has no 360 sale number." };

  try {
    const sale = (await api360(config, `/${encodeURIComponent(order.sale_number_360)}`)) as Sale360;
    let changed = false;

    // Confirming a quote in 360 creates a successor invoice — adopt the live
    // number so the admin banner and payment relays reference the invoice.
    const liveNumber = (sale.current_sale_number ?? "").trim();
    if (liveNumber && liveNumber !== order.sale_number_360) {
      await db`
        UPDATE orders SET sale_number_360 = ${liveNumber}, updated_at = now()
        WHERE id = ${orderId}
      `;
      changed = true;
    }

    // Lines: 360's current sale is the truth (edits, freight, fees included).
    const lines = (sale.lines ?? []).filter((l) => l.name && (l.qty ?? 0) > 0);
    if (lines.length > 0) {
      const current = await db<OrderItem[]>`
        SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY position, id
      `;
      const same =
        current.length === lines.length &&
        current.every(
          (c, i) =>
            c.sku === (lines[i].sku ?? "") &&
            c.name === lines[i].name &&
            c.quantity === lines[i].qty &&
            Number(c.unit_price_inc_gst) === Number(lines[i].unit_price_inc_gst ?? 0),
        );
      if (!same) {
        await db`DELETE FROM order_items WHERE order_id = ${orderId}`;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const sku = (line.sku ?? "").trim();
          const [product] = sku
            ? await db<{ id: number }[]>`SELECT id FROM products WHERE sku = ${sku}`
            : [];
          await db`
            INSERT INTO order_items (order_id, product_id, sku, name, quantity, unit_price_inc_gst, position)
            VALUES (${orderId}, ${product?.id ?? null}, ${sku}, ${line.name ?? ""},
                    ${Math.trunc(line.qty ?? 1)}, ${Number(line.unit_price_inc_gst ?? 0)}, ${i})
          `;
        }
        await refreshOrderTotal(db, orderId);
        changed = true;
      }
    }

    // Status: only forward moves (or cancellation) — never downgrade the portal.
    const mirrored = String(sale.status ?? "") as OrderStatus;
    const isKnown = mirrored in STATUS_RANK && mirrored !== "quote";
    if (isKnown && STATUS_RANK[mirrored] > STATUS_RANK[order.status]) {
      await db`
        UPDATE orders SET status = ${mirrored}, updated_at = now() WHERE id = ${orderId}
      `;
      changed = true;
      if (order.customer_email && (mirrored === "confirmed" || mirrored === "dispatched")) {
        const template =
          mirrored === "confirmed"
            ? emailTemplates.orderConfirmed(order.order_number ?? "", await getPaymentInfo(context))
            : emailTemplates.orderDispatched(order.order_number ?? "");
        queueEmail(context, { to: [order.customer_email], ...template });
      }
    }

    await db`
      UPDATE orders SET synced_360_at = now(), sync_360_error = NULL WHERE id = ${orderId}
    `;
    return { ok: true, changed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db`UPDATE orders SET sync_360_error = ${message}, updated_at = now() WHERE id = ${orderId}`;
    return { ok: false, error: message };
  }
}

/**
 * Cron sweep (rides the 15-min product-sync cron): retry pushes for submitted
 * orders that haven't reached 360 yet, then mirror every open pushed order.
 */
export async function syncOrders360(context: AppLoadContext) {
  const db = context.db;
  const config = await get360OrdersConfig(db);
  if (!config.enabled) return { pushed: 0, pulled: 0, skipped: true };

  const unpushed = await db<{ id: number }[]>`
    SELECT id FROM orders
    WHERE status = 'submitted' AND sale_number_360 IS NULL
    ORDER BY id LIMIT 25
  `;
  let pushed = 0;
  for (const row of unpushed) {
    if ((await pushOrderTo360(db, row.id)).ok) pushed++;
  }

  const open = await db<{ id: number }[]>`
    SELECT id FROM orders
    WHERE sale_number_360 IS NOT NULL
      AND status IN ('submitted', 'confirmed', 'picking', 'dispatched')
    ORDER BY id LIMIT 50
  `;
  let pulled = 0;
  for (const row of open) {
    if ((await pullOrderFrom360(context, row.id)).ok) pulled++;
  }
  return { pushed, pulled, skipped: false };
}

/** Relay a portal-recorded payment to 360's ledger. Never throws. */
export async function relayPaymentTo360(context: AppLoadContext, order: Order, payment: {
  amount: number;
  method: string;
  reference: string;
}) {
  if (!order.sale_number_360) return;
  const config = await get360OrdersConfig(context.db);
  if (!config.enabled) return;
  try {
    await api360(config, `/${encodeURIComponent(order.sale_number_360)}/payments`, {
      method: "POST",
      body: JSON.stringify({
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        paid_at: new Date().toISOString(),
        portal_order_ref: order.order_number,
      }),
    });
  } catch (err) {
    console.log("360 payment relay failed:", String(err));
  }
}
