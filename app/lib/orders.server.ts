import type { Sql } from "./db.server";
import type { Order, OrderItem, OrderStatus, Payment } from "./orders";

export async function refreshOrderTotal(db: Sql, orderId: number) {
  await db`
    UPDATE orders SET
      total_inc_gst = COALESCE(
        (SELECT SUM(quantity * unit_price_inc_gst) FROM order_items WHERE order_id = ${orderId}), 0),
      updated_at = now()
    WHERE id = ${orderId}
  `;
}

export async function createOrder(
  db: Sql,
  input: {
    status: OrderStatus;
    customer_id?: number | null;
    business_name?: string;
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    delivery_address?: string;
    delivery_method?: string;
    urgent_date?: string | null;
    note?: string;
    created_by_user_id?: number | null;
    lines: { product_id: number | null; sku: string; name: string; quantity: number; unit_price_inc_gst: number }[];
  },
) {
  const [order] = await db<{ id: number }[]>`
    INSERT INTO orders (status, customer_id, business_name, customer_name, customer_email,
                        customer_phone, delivery_address, delivery_method, urgent_date, note,
                        created_by_user_id, submitted_at)
    VALUES (${input.status}, ${input.customer_id ?? null}, ${input.business_name ?? ""},
            ${input.customer_name ?? ""}, ${input.customer_email ?? ""},
            ${input.customer_phone ?? ""}, ${input.delivery_address ?? ""},
            ${input.delivery_method ?? ""}, ${input.urgent_date ?? null}, ${input.note ?? ""},
            ${input.created_by_user_id ?? null},
            ${input.status === "submitted" ? new Date() : null})
    RETURNING id
  `;
  await db`
    UPDATE orders SET order_number = ${"TP-" + String(1000 + order.id)} WHERE id = ${order.id}
  `;
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    await db`
      INSERT INTO order_items (order_id, product_id, sku, name, quantity, unit_price_inc_gst, position)
      VALUES (${order.id}, ${line.product_id}, ${line.sku}, ${line.name},
              ${line.quantity}, ${line.unit_price_inc_gst}, ${i})
    `;
  }
  await refreshOrderTotal(db, order.id);
  return order.id;
}

export async function getOrder(db: Sql, id: number) {
  const [order] = await db<Order[]>`SELECT * FROM orders WHERE id = ${id}`;
  if (!order) return null;
  const items = await db<OrderItem[]>`
    SELECT oi.*, p.available_now
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ${id}
    ORDER BY oi.position, oi.id
  `;
  const payments = await db<Payment[]>`
    SELECT * FROM payments WHERE order_id = ${id} ORDER BY paid_at, id
  `;
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return { order, items, payments, paid, balance: Number(order.total_inc_gst) - paid };
}

export type OrderListFilter = "open" | "quotes" | OrderStatus | "all";

export async function listOrders(db: Sql, filter: OrderListFilter, search = "") {
  const term = search.trim() ? `%${search.trim()}%` : null;
  return db<(Order & { item_count: number; paid: string | null })[]>`
    SELECT o.*,
           (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS item_count,
           (SELECT SUM(amount) FROM payments p WHERE p.order_id = o.id) AS paid
    FROM orders o
    WHERE CASE ${filter}
        WHEN 'open' THEN o.status IN ('submitted', 'confirmed', 'picking')
        WHEN 'quotes' THEN o.status = 'quote'
        WHEN 'all' THEN TRUE
        ELSE o.status = ${filter}
      END
      AND (${term}::text IS NULL OR o.order_number ILIKE ${term}
           OR o.business_name ILIKE ${term} OR o.customer_name ILIKE ${term}
           OR o.customer_email ILIKE ${term})
    ORDER BY o.created_at DESC
    LIMIT 500
  `;
}

/** GST component of an inc-GST amount (prices are stored inc GST). */
export function gstComponent(incGst: number) {
  return incGst - incGst / 1.1;
}
