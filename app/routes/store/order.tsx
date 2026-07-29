import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { getCustomer } from "~/lib/customer-auth.server";
import { getOrder } from "~/lib/orders.server";
import { deliveryMethodLabel, STATUS_LABELS } from "~/lib/orders";
import { addToCart, readCart, serializeCart } from "~/lib/cart.server";
import { getPaymentInfo } from "~/lib/payment.server";
import { PaymentOptions } from "~/components/payment-options";
import { exGst, formatCurrency, formatDateTime } from "~/lib/utils";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

export function meta() {
  return [{ title: "Order — The Furniture Shack Trade" }];
}

async function requireOwnOrder(context: any, request: Request, idParam: string | undefined) {
  const customer = await getCustomer(context, request);
  if (!customer) throw redirect("/trade/login");
  const id = Number(idParam);
  if (!Number.isInteger(id)) throw new Response("Not found", { status: 404 });
  const data = await getOrder(context.db, id);
  if (!data || data.order.customer_id !== customer.id || data.order.status === "quote") {
    throw new Response("Not found", { status: 404 });
  }
  return { customer, data };
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { data } = await requireOwnOrder(context, request, params.id);
  const payment = await getPaymentInfo(context);
  return {
    order: data.order,
    paid: data.paid,
    balance: data.balance,
    payment,
    items: data.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unit: Number(i.unit_price_inc_gst),
    })),
  };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { data } = await requireOwnOrder(context, request, params.id);
  // Reorder: add all lines back to the cart.
  let cart = await readCart(context, request);
  for (const item of data.items) {
    cart = addToCart(cart, item.sku, item.quantity);
  }
  return redirect("/cart", {
    headers: { "Set-Cookie": await serializeCart(context, cart) },
  });
}

export default function CustomerOrder() {
  const { order, items, paid, balance, payment } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const total = Number(order.total_inc_gst);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {searchParams.get("placed") && (
        <Alert variant="success">
          Order placed — the trade team has been notified and will confirm it shortly. A GST
          invoice will follow; payment options are below.
        </Alert>
      )}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link to="/account/orders" className="underline-offset-4 hover:underline">
              Your orders
            </Link>{" "}
            / {order.order_number}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Order {order.order_number}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {order.submitted_at ? formatDateTime(order.submitted_at) : ""}
          </p>
        </div>
        <Badge>{STATUS_LABELS[order.status]}</Badge>
      </div>

      <Card>
        <CardContent className="divide-y divide-border pt-6">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{item.sku}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {item.quantity} × {formatCurrency(exGst(item.unit))} ex GST
              </p>
              <p className="w-24 text-right font-semibold">
                {formatCurrency(exGst(item.quantity * item.unit))}
              </p>
            </div>
          ))}
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
        </CardContent>
      </Card>

      {order.status !== "cancelled" && (
        <Card>
          <CardContent className="pt-6">
            {balance <= 0 && paid > 0 ? (
              <p className="text-sm font-semibold">
                Paid in full — thank you. Your order will be dispatched as arranged.
              </p>
            ) : (
              <>
                <PaymentOptions payment={payment} orderRef={order.order_number ?? undefined} />
                {paid > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Paid to date: {formatCurrency(paid)} · Balance due:{" "}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(Math.max(0, balance))}
                    </span>
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-1 text-sm text-muted-foreground">
        {order.delivery_method && (
          <p>
            <span className="font-medium text-foreground">Delivery option:</span>{" "}
            {deliveryMethodLabel(order.delivery_method)} (cost TBA — confirmed on your invoice)
          </p>
        )}
        {order.delivery_address && (
          <p>
            <span className="font-medium text-foreground">Delivery:</span>{" "}
            {order.delivery_address}
          </p>
        )}
      </div>

      <Form method="post">
        <Button type="submit" variant="outline" disabled={navigation.state !== "idle"}>
          Reorder — add all items to cart
        </Button>
      </Form>
    </div>
  );
}
