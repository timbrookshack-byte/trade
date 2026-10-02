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

/**
 * Login ping → 360's CRM feed ("fireworks", 360 v001.668): POST
 * /api/trade/portal-login with the customer's email on every successful
 * portal sign-in. 360 de-dupes to one firework per customer per day, so no
 * throttling here; matched:false in the response just means no 360 customer
 * matched. Not gated by orders_360_enabled — it only needs the feed
 * URL + token. Awaited with a hard timeout rather than waitUntil (background
 * fetches get cancelled on Workers) but NEVER throws — a 360 hiccup must
 * not affect or fail the sign-in.
 */
export async function notify360Login(
  db: Sql,
  customer: { email: string; business_name?: string; contact_name?: string; phone?: string },
) {
  try {
    const rows = await db<{ key: string; value: string }[]>`
      SELECT key, value FROM settings WHERE key IN ('trade_api_url', 'trade_api_token')
    `;
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!s.trade_api_url || !s.trade_api_token) return;
    const url = s.trade_api_url.replace(/\/products\/?$/, "") + "/portal-login";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${s.trade_api_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: customer.email,
        name: customer.business_name || customer.contact_name || "",
        phone: customer.phone || "",
      }),
      signal: AbortSignal.timeout(3000),
    });
    console.log(
      "360 portal-login:",
      response.status,
      response.ok ? JSON.stringify(await response.json()) : await response.text(),
    );
  } catch (err) {
    console.log("360 portal-login failed:", String(err));
  }
}

/**
 * Direct 360 sales → customer accounts. Stores sell in person / over the
 * phone straight into 360; this imports those sales (history back to
 * 1 July 2026 and everything onward) so customers see ALL their orders in
 * the portal and can print tax invoices.
 *
 * Contract (360 side): GET /api/trade/orders-feed?since=<ISO>&limit=100 —
 * commercial-branch sales UPDATED since the cursor, oldest first:
 *   { "orders": [ { "sale_number", "portal_order_ref", "status",
 *       "customer_email", "note", "delivery_address",
 *       "created_at", "updated_at", "total_inc_gst", "amount_paid",
 *       "lines": [ { "sku", "name", "qty", "unit_price_inc_gst" } ] } ] }
 *
 * Rules: portal-origin sales (portal_order_ref set) are SKIPPED — the
 * mirror owns those. Store quotes stay in 360 (only confirmed/dispatched/
 * completed import; cancelled only updates an already-imported sale).
 * Idempotent on sale_number (origin='360' unique index); the cursor lives
 * in settings.orders_360_import_cursor. No emails ever fire for these.
 * Gated by settings.orders_360_import_enabled='true'.
 */
interface FeedSale {
  sale_number: string;
  portal_order_ref?: string | null;
  status: string;
  customer_email: string;
  note?: string;
  delivery_address?: string;
  created_at?: string;
  updated_at?: string;
  total_inc_gst?: number;
  amount_paid?: number;
  lines?: { sku?: string; name?: string; qty?: number; unit_price_inc_gst?: number }[];
}

export async function import360Orders(
  context: AppLoadContext,
  opts: { maxPages?: number } = {},
) {
  const db = context.db;
  const result = { skipped: "", imported: 0, updated: 0, unmatched: 0, done: true };
  const rows = await db<{ key: string; value: string }[]>`
    SELECT key, value FROM settings WHERE key IN
      ('trade_api_url', 'trade_api_token', 'orders_360_import_enabled', 'orders_360_import_cursor')
  `;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (s.orders_360_import_enabled !== "true") return { ...result, skipped: "disabled" };
  if (!s.trade_api_url || !s.trade_api_token) return { ...result, skipped: "360 not configured" };
  const base = s.trade_api_url.replace(/\/products\/?$/, "");
  let cursor = s.orders_360_import_cursor || "2026-07-01T00:00:00Z";

  const maxPages = Math.max(1, opts.maxPages ?? 10);
  const saveCursor = () => db`
    INSERT INTO settings (key, value) VALUES ('orders_360_import_cursor', ${cursor})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `;
  try {
    for (let page = 0; page < maxPages; page++) {
      const response = await fetch(
        `${base}/orders-feed?since=${encodeURIComponent(cursor)}&limit=100`,
        {
          headers: { Authorization: `Bearer ${s.trade_api_token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok) {
        return { ...result, skipped: `feed returned ${response.status}` };
      }
      const data = (await response.json()) as { orders?: FeedSale[] };
      const sales = data.orders ?? [];
      for (const sale of sales) {
        if (sale.updated_at && sale.updated_at > cursor) cursor = sale.updated_at;
        if (!sale.sale_number || sale.portal_order_ref) continue; // mirror owns portal orders
        if (!["confirmed", "dispatched", "completed", "cancelled"].includes(sale.status)) continue;
        const [customer] = await db<
          { id: number; business_name: string; contact_name: string; email: string; phone: string }[]
        >`
          SELECT id, business_name, contact_name, email, phone FROM customers
          WHERE lower(email) = lower(${sale.customer_email ?? ""}) AND active
        `;
        if (!customer) {
          result.unmatched++;
          continue;
        }
        const [existing] = await db<{ id: number }[]>`
          SELECT id FROM orders WHERE origin = '360' AND sale_number_360 = ${sale.sale_number}
        `;
        if (!existing && sale.status === "cancelled") continue;

        const total = Number(sale.total_inc_gst) || 0;
        let orderId: number;
        if (existing) {
          await db`
            UPDATE orders SET status = ${sale.status}, note = ${sale.note ?? ""},
              delivery_address = ${sale.delivery_address ?? ""},
              total_inc_gst = ${total}, synced_360_at = now(), updated_at = now()
            WHERE id = ${existing.id}
          `;
          orderId = existing.id;
          result.updated++;
        } else {
          const [created] = await db<{ id: number }[]>`
            INSERT INTO orders (order_number, origin, status, customer_id, business_name,
                                customer_name, customer_email, customer_phone,
                                delivery_address, note, total_inc_gst, sale_number_360,
                                submitted_at, synced_360_at)
            VALUES (${sale.sale_number}, '360', ${sale.status}, ${customer.id},
                    ${customer.business_name}, ${customer.contact_name}, ${customer.email},
                    ${customer.phone}, ${sale.delivery_address ?? ""}, ${sale.note ?? ""},
                    ${total}, ${sale.sale_number},
                    ${sale.created_at ?? new Date().toISOString()}, now())
            RETURNING id
          `;
          orderId = created.id;
          result.imported++;
        }
        await db`DELETE FROM order_items WHERE order_id = ${orderId}`;
        const lines = sale.lines ?? [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          await db`
            INSERT INTO order_items (order_id, product_id, sku, name, quantity,
                                     unit_price_inc_gst, position)
            VALUES (${orderId},
                    (SELECT id FROM products WHERE upper(sku) = upper(${line.sku ?? ""}) LIMIT 1),
                    ${line.sku ?? ""}, ${line.name ?? ""},
                    ${Math.max(1, Math.trunc(Number(line.qty) || 1))},
                    ${Number(line.unit_price_inc_gst) || 0}, ${i})
          `;
        }
        // One synthetic payment row mirrors 360's ledger so the customer's
        // invoice shows the right paid/balance. Never relayed back.
        await db`DELETE FROM payments WHERE order_id = ${orderId} AND reference = ${"360:" + sale.sale_number}`;
        const paid = Number(sale.amount_paid) || 0;
        if (paid > 0) {
          await db`
            INSERT INTO payments (order_id, method, amount, reference)
            VALUES (${orderId}, 'other', ${paid}, ${"360:" + sale.sale_number})
          `;
        }
      }
      // Persist progress after EVERY page: if a long backfill run is cut
      // short, the next run (click or cron) resumes where this one got to.
      await saveCursor();
      if (sales.length < 100) return result;
    }
    result.done = false; // page budget used up with a full page — more waiting
  } catch (err) {
    return { ...result, skipped: `feed error: ${String(err)}` };
  }
  return result;
}
