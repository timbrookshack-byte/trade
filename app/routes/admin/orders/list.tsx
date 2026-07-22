import {
  Form,
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { listOrders, type OrderListFilter } from "~/lib/orders.server";
import { STATUS_LABELS, type Order, type OrderStatus } from "~/lib/orders";
import { cn, formatCurrency, formatDateTime } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
  return [{ title: "Orders — Trade Portal" }];
}

const FILTERS: { key: OrderListFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "submitted", label: "Submitted" },
  { key: "confirmed", label: "Confirmed" },
  { key: "picking", label: "Picking" },
  { key: "dispatched", label: "Dispatched" },
  { key: "completed", label: "Completed" },
  { key: "quotes", label: "Quotes" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const url = new URL(request.url);
  const filterParam = url.searchParams.get("filter");
  const filter = (FILTERS.find((f) => f.key === filterParam)?.key ?? "open") as OrderListFilter;
  const search = url.searchParams.get("q") ?? "";
  const orders = await listOrders(context.db, filter, search);
  return { orders, filter, search };
}

function statusVariant(status: OrderStatus) {
  if (status === "cancelled") return "destructive" as const;
  if (status === "quote") return "outline" as const;
  if (status === "completed" || status === "dispatched") return "default" as const;
  return "secondary" as const;
}

export default function OrdersList() {
  const { orders, filter, search } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Orders are invoiced and paid before dispatch. Quotes convert to orders when the
          customer goes ahead.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            to={`/admin/orders?filter=${f.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            {f.label}
          </Link>
        ))}
        <Form method="get" className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value={searchParams.get("filter") ?? "open"} />
          <Input name="q" placeholder="Order #, business, contact…" defaultValue={search} className="w-64" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Form>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total inc GST</TableHead>
                <TableHead className="text-right">Paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Nothing here yet.
                  </TableCell>
                </TableRow>
              )}
              {orders.map((order: Order & { item_count: number; paid: string | null }) => {
                const total = Number(order.total_inc_gst);
                const paid = Number(order.paid ?? 0);
                return (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {order.order_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{order.business_name || order.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(order.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(order.status)}>
                        {STATUS_LABELS[order.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{order.item_count}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(total)}
                    </TableCell>
                    <TableCell className="text-right">
                      {order.status === "quote" ? (
                        "—"
                      ) : paid >= total && total > 0 ? (
                        <span className="font-medium text-green-700">paid</span>
                      ) : paid > 0 ? (
                        <span className="text-amber-700">{formatCurrency(paid)}</span>
                      ) : (
                        <span className="text-muted-foreground">unpaid</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
