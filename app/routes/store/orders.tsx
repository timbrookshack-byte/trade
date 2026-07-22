import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getCustomer } from "~/lib/customer-auth.server";
import { STATUS_LABELS, type Order, type OrderStatus } from "~/lib/orders";
import { formatCurrency, formatDate } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export function meta() {
  return [{ title: "Your orders — The Furniture Shack Trade" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const customer = await getCustomer(context, request);
  if (!customer) throw redirect("/trade/login");
  const orders = await context.db<Order[]>`
    SELECT * FROM orders
    WHERE customer_id = ${customer.id} AND status <> 'quote'
    ORDER BY created_at DESC
    LIMIT 200
  `;
  return { orders };
}

function statusVariant(status: OrderStatus) {
  if (status === "cancelled") return "destructive" as const;
  if (status === "completed" || status === "dispatched") return "default" as const;
  return "secondary" as const;
}

export default function CustomerOrders() {
  const { orders } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Your orders</h1>
      {orders.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          No orders yet —{" "}
          <Link to="/products" className="underline underline-offset-4">
            browse the range
          </Link>
          .
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total inc GST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order: Order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        to={`/account/orders/${order.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {order.order_number}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(order.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(order.status)}>
                        {STATUS_LABELS[order.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(Number(order.total_inc_gst))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
