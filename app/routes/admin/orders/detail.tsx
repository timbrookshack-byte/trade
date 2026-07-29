import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getOrder, refreshOrderTotal } from "~/lib/orders.server";
import {
  DELIVERY_METHODS,
  deliveryMethodLabel,
  NEXT_STATUSES,
  STATUS_LABELS,
  type OrderItem,
  type OrderStatus,
  type Payment,
} from "~/lib/orders";
import { emailTemplates, queueEmail } from "~/lib/email.server";
import { getPaymentInfo } from "~/lib/payment.server";
import {
  get360OrdersConfig,
  pullOrderFrom360,
  pushOrderTo360,
  relayPaymentTo360,
} from "~/lib/three60-orders.server";
import { exGst, formatCurrency, formatDate, formatDateTime } from "~/lib/utils";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input, Select, Textarea } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta() {
  return [{ title: "Order — Trade Portal" }];
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new Response("Not found", { status: 404 });
  const data = await getOrder(context.db, id);
  if (!data) throw new Response("Not found", { status: 404 });
  const orders360 = (await get360OrdersConfig(context.db)).enabled;
  return { ...data, orders360 };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const user = await requireUser(context, request);
  const db = context.db;
  const id = Number(params.id);
  const data = await getOrder(db, id);
  if (!data) throw new Response("Not found", { status: 404 });
  const { order } = data;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "sync360") {
    const result = await pullOrderFrom360(context, id);
    if (!result.ok) return { error: `Refresh from 360 failed: ${result.error}` };
    return {
      ok: result.changed
        ? "Refreshed from 360 — lines/status updated."
        : "Refreshed from 360 — already up to date.",
    };
  }

  if (intent === "status") {
    const next = String(form.get("status") ?? "") as OrderStatus;
    if (!NEXT_STATUSES[order.status]?.includes(next)) {
      return { error: `Can't move a ${STATUS_LABELS[order.status]} order to ${next}.` };
    }
    await db`
      UPDATE orders SET status = ${next},
        submitted_at = CASE WHEN ${next} = 'submitted' AND submitted_at IS NULL THEN now() ELSE submitted_at END,
        updated_at = now()
      WHERE id = ${id}
    `;
    // A quote converted to an order heads to 360 like a customer submission.
    if (next === "submitted") {
      const push = await pushOrderTo360(db, id);
      if (!push.ok) console.log("360 order push:", push.error);
    }
    if (order.customer_email && (next === "confirmed" || next === "dispatched")) {
      const template =
        next === "confirmed"
          ? emailTemplates.orderConfirmed(
              order.order_number ?? "",
              await getPaymentInfo(context),
            )
          : emailTemplates.orderDispatched(order.order_number ?? "");
      queueEmail(context, { to: [order.customer_email], ...template });
    }
    return { ok: `Order moved to ${STATUS_LABELS[next]}.` };
  }

  if (intent === "payment") {
    if (order.status === "quote" || order.status === "cancelled") {
      return { error: "Payments can't be recorded on quotes or cancelled orders." };
    }
    const amount = Number(String(form.get("amount") ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Payment amount must be a positive number." };
    }
    const methodRaw = String(form.get("method") ?? "eft");
    const method = ["eft", "card", "cash", "other"].includes(methodRaw) ? methodRaw : "eft";
    const reference = String(form.get("reference") ?? "").trim();
    await db`
      INSERT INTO payments (order_id, method, amount, reference, created_by_user_id)
      VALUES (${id}, ${method}, ${amount}, ${reference}, ${user.id})
    `;
    // Keep 360's ledger whole (no-op when the order isn't linked/enabled).
    await relayPaymentTo360(context, order, { amount, method, reference });
    return { ok: `Payment of ${formatCurrency(amount)} recorded.` };
  }

  // Quote editing — only while it's still a quote.
  if (order.status !== "quote") return { error: "Lines can only be edited on quotes." };

  if (intent === "update-line") {
    const lineId = Number(form.get("line_id"));
    const qty = Math.trunc(Number(form.get("qty")) || 0);
    const price = Number(String(form.get("unit_price") ?? "").replace(/[$,\s]/g, ""));
    if (qty <= 0) {
      await db`DELETE FROM order_items WHERE id = ${lineId} AND order_id = ${id}`;
    } else if (Number.isFinite(price) && price >= 0) {
      await db`
        UPDATE order_items SET quantity = ${qty}, unit_price_inc_gst = ${price}
        WHERE id = ${lineId} AND order_id = ${id}
      `;
    }
    await refreshOrderTotal(db, id);
    return { ok: "Quote updated." };
  }

  if (intent === "add-line") {
    const sku = String(form.get("sku") ?? "").trim().toUpperCase();
    const [product] = await db<
      { id: number; sku: string; name: string; trade_price: string | null }[]
    >`
      SELECT id, sku, name, trade_price FROM products WHERE upper(sku) = ${sku}
    `;
    if (!product) return { error: `SKU ${sku} not found.` };
    await db`
      INSERT INTO order_items (order_id, product_id, sku, name, quantity, unit_price_inc_gst, position)
      VALUES (${id}, ${product.id}, ${product.sku}, ${product.name}, 1,
              ${product.trade_price ?? 0},
              (SELECT COALESCE(MAX(position), 0) + 1 FROM order_items WHERE order_id = ${id}))
    `;
    await refreshOrderTotal(db, id);
    return { ok: `${product.sku} added to the quote.` };
  }

  if (intent === "update-details") {
    await db`
      UPDATE orders SET
        business_name = ${String(form.get("business_name") ?? "").trim()},
        customer_name = ${String(form.get("customer_name") ?? "").trim()},
        customer_email = ${String(form.get("customer_email") ?? "").trim()},
        customer_phone = ${String(form.get("customer_phone") ?? "").trim()},
        delivery_address = ${String(form.get("delivery_address") ?? "").trim()},
        delivery_method = ${DELIVERY_METHODS.some((m) => m.value === form.get("delivery_method")) ? String(form.get("delivery_method")) : ""},
        urgent_date = ${/^\d{4}-\d{2}-\d{2}$/.test(String(form.get("urgent_date") ?? "")) ? String(form.get("urgent_date")) : null},
        note = ${String(form.get("note") ?? "").trim()},
        updated_at = now()
      WHERE id = ${id}
    `;
    return { ok: "Details saved." };
  }

  return { error: "Unknown action." };
}

export default function OrderDetail() {
  const { order, items, payments, paid, balance, orders360 } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const isQuote = order.status === "quote";
  const total = Number(order.total_inc_gst);
  const nextStatuses = NEXT_STATUSES[order.status] ?? [];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link to="/admin/orders" className="underline-offset-4 hover:underline">
              Orders
            </Link>{" "}
            / {order.order_number}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isQuote ? "Quote" : "Order"} {order.order_number}
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge>{STATUS_LABELS[order.status]}</Badge>
            {order.sale_number_360 && (
              <Badge variant="outline">360 · {order.sale_number_360}</Badge>
            )}
            <span className="text-sm text-muted-foreground">
              created {formatDateTime(order.created_at)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isQuote ? (
            <Link
              to={`/admin/orders/${order.id}/doc?type=quote`}
              className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent"
            >
              Quote PDF
            </Link>
          ) : (
            <>
              <Link
                to={`/admin/orders/${order.id}/doc?type=invoice`}
                className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                Invoice PDF
              </Link>
              <Link
                to={`/admin/orders/${order.id}/doc?type=packing`}
                className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent"
              >
                Packing slip
              </Link>
            </>
          )}
          {nextStatuses.map((next) => (
            <Form key={next} method="post">
              <input type="hidden" name="intent" value="status" />
              <input type="hidden" name="status" value={next} />
              <Button
                type="submit"
                size="sm"
                variant={next === "cancelled" ? "destructive" : "default"}
                disabled={busy}
              >
                {next === "submitted" ? "Convert to order" : `Mark ${STATUS_LABELS[next]}`}
              </Button>
            </Form>
          ))}
        </div>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <Alert variant="success">{actionData.ok}</Alert>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      {order.sale_number_360 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          <p className="min-w-0 flex-1">
            <span className="font-medium">Managed in 360</span> — sale{" "}
            <span className="font-mono">{order.sale_number_360}</span>. Edit and confirm the
            sale in 360; the portal mirrors lines, freight and status back automatically
            {order.synced_360_at && <> (last synced {formatDateTime(order.synced_360_at)})</>}.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="sync360" />
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              Refresh from 360
            </Button>
          </Form>
        </div>
      ) : (
        orders360 &&
        order.status === "submitted" && (
          <Alert variant="destructive">
            Not in 360 yet{order.sync_360_error && <> — last attempt: {order.sync_360_error}</>}.
            The sync retries every 15 minutes.
          </Alert>
        )
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          {isQuote && (
            <CardDescription>
              Adjust quantities and prices while this is a quote. Qty 0 removes a line.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {items.map((item: OrderItem) => {
            const short =
              item.available_now != null && item.quantity > item.available_now;
            return (
              <div key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
                  {short && !isQuote && (
                    <p className="text-xs font-medium text-destructive">
                      ⚠ qty {item.quantity} exceeds cached stock ({item.available_now}) — confirm
                      with the warehouse
                    </p>
                  )}
                </div>
                {isQuote ? (
                  <Form method="post" className="flex items-center gap-2">
                    <input type="hidden" name="intent" value="update-line" />
                    <input type="hidden" name="line_id" value={item.id} />
                    <Input name="qty" type="number" min={0} defaultValue={item.quantity} className="h-9 w-20" />
                    <Input
                      name="unit_price"
                      inputMode="decimal"
                      defaultValue={item.unit_price_inc_gst}
                      className="h-9 w-28"
                    />
                    <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                      Save
                    </Button>
                  </Form>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {item.quantity} × {formatCurrency(Number(item.unit_price_inc_gst))}
                  </p>
                )}
                <p className="w-28 text-right font-semibold">
                  {formatCurrency(item.quantity * Number(item.unit_price_inc_gst))}
                </p>
              </div>
            );
          })}
          {isQuote && (
            <Form method="post" className="flex items-end gap-2 py-3">
              <input type="hidden" name="intent" value="add-line" />
              <div className="flex flex-col gap-1">
                <Label htmlFor="add-sku" className="text-xs">
                  Add product by SKU
                </Label>
                <Input id="add-sku" name="sku" placeholder="SKU" className="h-9 w-48" />
              </div>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                Add line
              </Button>
            </Form>
          )}
          <div className="flex justify-end gap-8 py-4 text-sm">
            <div className="text-right">
              <p className="text-muted-foreground">Total ex GST</p>
              <p className="text-muted-foreground">GST</p>
              <p className="mt-1 text-base font-bold text-foreground">Total inc GST</p>
            </div>
            <div className="text-right">
              <p>{formatCurrency(exGst(total))}</p>
              <p>{formatCurrency(total - exGst(total))}</p>
              <p className="mt-1 text-base font-bold">{formatCurrency(total)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent>
            {isQuote ? (
              <Form method="post" className="flex flex-col gap-3">
                <input type="hidden" name="intent" value="update-details" />
                <Input name="business_name" placeholder="Business name" defaultValue={order.business_name} />
                <Input name="customer_name" placeholder="Contact name" defaultValue={order.customer_name} />
                <Input name="customer_email" placeholder="Email" defaultValue={order.customer_email} />
                <Input name="customer_phone" placeholder="Phone" defaultValue={order.customer_phone} />
                <select
                  name="delivery_method"
                  defaultValue={order.delivery_method || ""}
                  className="h-10 rounded-md border border-input bg-card px-3 text-sm"
                >
                  <option value="">Delivery option TBA…</option>
                  {DELIVERY_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <Textarea name="delivery_address" placeholder="Delivery address" rows={2} defaultValue={order.delivery_address} />
                <div className="flex items-center gap-2">
                  <Label htmlFor="q-urgent" className="text-xs text-muted-foreground">
                    Urgent — required by
                  </Label>
                  <input
                    id="q-urgent"
                    name="urgent_date"
                    type="date"
                    defaultValue={order.urgent_date ?? ""}
                    className="h-9 rounded-md border border-input bg-card px-3 text-sm"
                  />
                </div>
                <Textarea name="note" placeholder="Note" rows={2} defaultValue={order.note} />
                <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                  Save details
                </Button>
              </Form>
            ) : (
              <div className="space-y-1 text-sm">
                <p className="font-medium">{order.business_name}</p>
                <p>{order.customer_name}</p>
                <p>{order.customer_email}</p>
                <p>{order.customer_phone}</p>
                {order.delivery_method && (
                  <p className="pt-2 font-medium">{deliveryMethodLabel(order.delivery_method)}</p>
                )}
                {order.urgent_date && (
                  <p className="font-medium text-destructive">
                    ⚠ Urgent — required by {formatDate(order.urgent_date)}
                  </p>
                )}
                {order.delivery_address && (
                  <p>
                    <span className="text-muted-foreground">Delivery:</span>{" "}
                    {order.delivery_address}
                  </p>
                )}
                {order.note && (
                  <p>
                    <span className="text-muted-foreground">Note:</span> {order.note}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              {order.status === "quote" ? (
                "Available once this becomes an order."
              ) : (
                <>
                  Paid {formatCurrency(paid)} of {formatCurrency(total)} —{" "}
                  {balance <= 0.005 ? (
                    <span className="font-medium text-green-700">paid in full</span>
                  ) : (
                    <span className="font-medium text-amber-700">
                      {formatCurrency(balance)} outstanding
                    </span>
                  )}
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {payments.length > 0 && (
              <ul className="space-y-1 text-sm">
                {payments.map((p: Payment) => (
                  <li key={p.id} className="flex justify-between">
                    <span>
                      {formatDate(p.paid_at)} · {p.method.toUpperCase()}
                      {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                    </span>
                    <span className="font-medium">{formatCurrency(Number(p.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
            {order.status !== "quote" && order.status !== "cancelled" && (
              <Form method="post" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="payment" />
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pay-amount" className="text-xs">
                    Amount
                  </Label>
                  <Input id="pay-amount" name="amount" inputMode="decimal" placeholder="0.00" className="h-9 w-28" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pay-method" className="text-xs">
                    Method
                  </Label>
                  <Select id="pay-method" name="method" className="h-9 w-28" defaultValue="eft">
                    <option value="eft">EFT</option>
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="pay-ref" className="text-xs">
                    Reference
                  </Label>
                  <Input id="pay-ref" name="reference" placeholder="e.g. bank ref" className="h-9 w-36" />
                </div>
                <Button type="submit" size="sm" disabled={busy}>
                  Record payment
                </Button>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
