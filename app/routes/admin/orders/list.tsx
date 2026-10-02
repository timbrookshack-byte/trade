import {
  Form,
  useActionData,
  Link,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { import360Orders } from "~/lib/three60-orders.server";
import { countOrders, listOrders, ORDERS_PER_PAGE, type OrderListFilter } from "~/lib/orders.server";
import { STATUS_LABELS, type Order, type OrderStatus } from "~/lib/orders";
import { cn, formatCurrency, formatDateTime } from "~/lib/utils";
import { Alert } from "~/components/ui/alert";
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
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const [orders, total] = await Promise.all([
    listOrders(context.db, filter, search, page),
    countOrders(context.db, filter, search),
  ]);
  return { orders, filter, search, page, total, perPage: ORDERS_PER_PAGE };
}

function statusVariant(status: OrderStatus) {
  if (status === "cancelled") return "destructive" as const;
  if (status === "quote") return "outline" as const;
  if (status === "completed" || status === "dispatched") return "default" as const;
  return "secondary" as const;
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  if (form.get("intent") === "import-360") {
    // A manual click processes a bounded chunk so the request always comes
    // back quickly — the cron (or another click) continues a long backfill.
    const result = await import360Orders(context, { maxPages: 2 });
    if (result.skipped) {
      return { error: `360 import didn't run — ${result.skipped}.` };
    }
    return {
      ok: `360 import: ${result.imported} new, ${result.updated} updated${
        result.unmatched > 0 ? `, ${result.unmatched} skipped (no matching customer email)` : ""
      }.${result.done ? "" : " More to import — click again, or the 15-minute sync will keep going."}`,
    };
  }
  return null;
}

export default function OrdersList() {
  const { orders, filter, search, page, total, perPage } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const importing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "import-360";
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const pageQuery = `filter=${filter}${search ? `&q=${encodeURIComponent(search)}` : ""}`;
  const actionData = useActionData<typeof action>();
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

      <div className="flex flex-col gap-3">
        <Form method="post">
          <input type="hidden" name="intent" value="import-360" />
          <Button type="submit" variant="outline" size="sm" disabled={importing}>
            {importing ? "Importing from 360…" : "Import direct 360 sales now"}
          </Button>
        </Form>
        {actionData && "ok" in actionData && actionData.ok && (
          <Alert variant="success">{actionData.ok}</Alert>
        )}
        {actionData && "error" in actionData && actionData.error && (
          <Alert variant="destructive">{actionData.error}</Alert>
        )}
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
          {total > perPage && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
              </span>
              <span className="flex gap-2">
                {page > 1 && (
                  <Link
                    to={`/admin/orders?${pageQuery}&page=${page - 1}`}
                    className="rounded-md border border-input bg-card px-3 py-1.5 font-medium hover:bg-accent"
                  >
                    ← Previous
                  </Link>
                )}
                {page < lastPage && (
                  <Link
                    to={`/admin/orders?${pageQuery}&page=${page + 1}`}
                    className="rounded-md border border-input bg-card px-3 py-1.5 font-medium hover:bg-accent"
                  >
                    Next →
                  </Link>
                )}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
