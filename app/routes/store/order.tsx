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
import { STATUS_LABELS } from "~/lib/orders";
import { addToCart, readCart, serializeCart } from "~/lib/cart.server";
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
  return {
    order: data.order,
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
  const { order, items } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const total = Number(order.total_inc_gst);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {searchParams.get("placed") && (
        <Alert variant="success">
          Order placed — the trade team has been notified and will confirm it shortly. A GST
          invoice will follow; payment by EFT before dispatch.
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
                {item.quantity} × {formatCurrency(item.unit)}
              </p>
              <p className="w-24 text-right font-semibold">
                {formatCurrency(item.quantity * item.unit)}
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

      {order.delivery_address && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Delivery:</span>{" "}
          {order.delivery_address}
        </p>
      )}

      <Form method="post">
        <Button type="submit" variant="outline" disabled={navigation.state !== "idle"}>
          Reorder — add all items to cart
        </Button>
      </Form>
    </div>
  );
}
