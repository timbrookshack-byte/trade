import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getCustomer } from "~/lib/customer-auth.server";
import { readCart, serializeCart, type CartLine } from "~/lib/cart.server";
import { createOrder } from "~/lib/orders.server";
import { emailTemplates, getNotifyAddress, queueEmail } from "~/lib/email.server";
import type { Product } from "~/lib/products";
import { exGst, formatCurrency } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input, Textarea } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert } from "~/components/ui/alert";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Cart — The Furniture Shack Trade" }];
}

async function loadCartLines(context: Parameters<typeof readCart>[0], request: Request) {
  const cart = await readCart(context, request);
  if (cart.length === 0) return [];
  const skus = cart.map((l) => l.sku);
  const db = context.db;
  const products = await db<Product[]>`
    SELECT * FROM products
    WHERE sku IN ${db(skus)} AND active AND discontinued_at IS NULL AND trade_price IS NOT NULL
  `;
  return cart
    .map((line) => {
      const product = products.find((p) => p.sku === line.sku);
      return product ? { ...line, product } : null;
    })
    .filter((l): l is CartLine & { product: Product } => l !== null);
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const customer = await getCustomer(context, request);
  if (!customer) throw redirect("/trade/login?from=cart");
  const lines = await loadCartLines(context, request);
  const total = lines.reduce((sum, l) => sum + l.qty * Number(l.product.trade_price), 0);
  return {
    approved: customer.approved,
    address: customer.address,
    lines: lines.map((l) => ({
      sku: l.sku,
      qty: l.qty,
      name: l.product.name,
      image_url: l.product.image_url,
      unit: customer.approved ? Number(l.product.trade_price) : null,
    })),
    total: customer.approved ? total : null,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const customer = await getCustomer(context, request);
  if (!customer) throw redirect("/trade/login");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const cart = await readCart(context, request);

  if (intent === "update") {
    const sku = String(form.get("sku") ?? "");
    const qty = Math.max(0, Math.min(999, Math.trunc(Number(form.get("qty")) || 0)));
    const next = cart
      .map((l) => (l.sku === sku ? { ...l, qty } : l))
      .filter((l) => l.qty > 0);
    return redirect("/cart", {
      headers: { "Set-Cookie": await serializeCart(context, next) },
    });
  }

  if (intent === "submit") {
    if (!customer.approved) {
      return { error: "Your application is still under review — ordering unlocks on approval." };
    }
    const lines = await loadCartLines(context, request);
    if (lines.length === 0) return { error: "Your cart is empty." };
    const deliveryAddress = String(form.get("delivery_address") ?? "").trim();
    if (!deliveryAddress) return { error: "Please enter a delivery address." };

    const orderId = await createOrder(context.db, {
      status: "submitted",
      customer_id: customer.id,
      business_name: customer.business_name,
      customer_name: customer.contact_name,
      customer_email: customer.email,
      customer_phone: customer.phone,
      delivery_address: deliveryAddress,
      note: String(form.get("note") ?? "").trim(),
      lines: lines.map((l) => ({
        product_id: l.product.id,
        sku: l.sku,
        name: l.product.name,
        quantity: l.qty,
        unit_price_inc_gst: Number(l.product.trade_price),
      })),
    });
    const [order] = await context.db<{ order_number: string; total_inc_gst: string }[]>`
      SELECT order_number, total_inc_gst FROM orders WHERE id = ${orderId}
    `;
    const total = formatCurrency(Number(order.total_inc_gst));
    queueEmail(context, {
      to: [customer.email],
      ...emailTemplates.orderSubmitted(order.order_number, total),
    });
    const notify = await getNotifyAddress(context);
    if (notify) {
      queueEmail(context, {
        to: [notify],
        ...emailTemplates.orderSubmittedTeam(order.order_number, customer.business_name, total),
      });
    }
    return redirect(`/account/orders/${orderId}?placed=1`, {
      headers: { "Set-Cookie": await serializeCart(context, []) },
    });
  }
  return null;
}

export default function CartPage() {
  const { approved, address, lines, total } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Your cart</h1>

      {actionData?.error && <Alert variant="destructive">{actionData.error}</Alert>}
      {!approved && (
        <Alert>
          Your application is under review — you can build a cart, and ordering unlocks the
          moment you're approved.
        </Alert>
      )}

      {lines.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          Your cart is empty —{" "}
          <Link to="/products" className="underline underline-offset-4">
            browse the range
          </Link>
          .
        </p>
      ) : (
        <>
          <Card>
            <CardContent className="divide-y divide-border pt-6">
              {lines.map((line) => (
                <div key={line.sku} className="flex items-center gap-4 py-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                    {line.image_url && (
                      <img src={line.image_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/products/${encodeURIComponent(line.sku)}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {line.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{line.sku}</p>
                    {line.unit != null && (
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(line.unit)} inc GST each
                      </p>
                    )}
                  </div>
                  <Form method="post" className="flex items-center gap-2">
                    <input type="hidden" name="intent" value="update" />
                    <input type="hidden" name="sku" value={line.sku} />
                    <Input
                      name="qty"
                      type="number"
                      min={0}
                      max={999}
                      defaultValue={line.qty}
                      className="h-9 w-20"
                    />
                    <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                      Update
                    </Button>
                  </Form>
                  {line.unit != null && (
                    <p className="w-24 text-right font-semibold">
                      {formatCurrency(line.unit * line.qty)}
                    </p>
                  )}
                </div>
              ))}
              {total != null && (
                <div className="flex justify-end gap-8 py-4 text-sm">
                  <div className="text-right">
                    <p className="text-muted-foreground">Total ex GST</p>
                    <p className="text-muted-foreground">GST</p>
                    <p className="mt-1 text-lg font-bold text-foreground">Total inc GST</p>
                  </div>
                  <div className="text-right">
                    <p>{formatCurrency(exGst(total))}</p>
                    <p>{formatCurrency(total - exGst(total))}</p>
                    <p className="mt-1 text-lg font-bold">{formatCurrency(total)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {approved && (
            <Card>
              <CardContent className="pt-6">
                <Form method="post" className="flex flex-col gap-4">
                  <input type="hidden" name="intent" value="submit" />
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="delivery_address">Delivery address</Label>
                    <Textarea
                      id="delivery_address"
                      name="delivery_address"
                      required
                      rows={2}
                      defaultValue={address}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="note">Order note (optional)</Label>
                    <Textarea id="note" name="note" rows={2} placeholder="PO number, delivery instructions…" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Submitting sends the order to the trade team. You'll receive a GST invoice —
                    payment by EFT before dispatch.
                  </p>
                  <Button
                    type="submit"
                    disabled={busy}
                    className="bg-brand text-brand-foreground hover:bg-brand/90"
                  >
                    {busy ? "Submitting…" : "Submit order"}
                  </Button>
                </Form>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
