import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { RefreshCw } from "lucide-react";
import { requireUser } from "~/lib/auth.server";
import { PRODUCT_FILTERS, type Product, type ProductFilter } from "~/lib/products";
import { listProducts } from "~/lib/products.server";
import { getLastSyncRuns, runSync } from "~/lib/sync.server";
import { cn, formatCurrency, formatDateTime } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Alert } from "~/components/ui/alert";
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
  return [{ title: "Products — Trade Portal" }];
}

function parseFilter(value: string | null): ProductFilter {
  return (PRODUCT_FILTERS.find((f) => f.key === value)?.key ?? "all") as ProductFilter;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const url = new URL(request.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const search = url.searchParams.get("q") ?? "";
  const [products, syncRuns] = await Promise.all([
    listProducts(context.db, filter, search),
    getLastSyncRuns(context.db, 1),
  ]);
  return { products, lastSync: syncRuns[0] ?? null, filter, search };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  if (form.get("intent") === "sync") {
    const result = await runSync(context.db, "manual");
    return { syncResult: result };
  }
  return null;
}

export default function ProductsList() {
  const { products, lastSync, filter, search } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const actionData = useActionData<typeof action>();
  const syncing =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "sync";
  const syncResult = navigation.state === "idle" ? actionData?.syncResult : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            {lastSync ? (
              <>
                Last 360 sync: {formatDateTime(lastSync.started_at)} —{" "}
                {lastSync.status === "success"
                  ? `${lastSync.products_in_feed} products (${lastSync.created_count} new, ${lastSync.discontinued_count} discontinued)`
                  : lastSync.status}
              </>
            ) : (
              "Never synced from 360 yet — run the first sync."
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Form method="post">
            <input type="hidden" name="intent" value="sync" />
            <Button type="submit" variant="outline" disabled={syncing}>
              <RefreshCw className={cn(syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </Form>
          <Link
            to="/admin/products/new"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add portal product
          </Link>
        </div>
      </div>

      {syncResult && syncResult.status === "success" && (
        <Alert variant="success">
          Sync complete: {syncResult.productsInFeed} products in feed, {syncResult.created} new,{" "}
          {syncResult.updated} updated, {syncResult.discontinued} discontinued.
          {(syncResult.created ?? 0) > 0 && (
            <>
              {" "}
              <Link to="/admin/products?filter=new" className="font-medium underline underline-offset-4">
                Review new products
              </Link>
            </>
          )}
        </Alert>
      )}
      {syncResult && syncResult.status === "error" && (
        <Alert variant="destructive">Sync failed: {syncResult.error}</Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {PRODUCT_FILTERS.map((f) => (
          <Link
            key={f.key}
            to={`/admin/products?filter=${f.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
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
          <input type="hidden" name="filter" value={searchParams.get("filter") ?? "all"} />
          <Input
            name="q"
            placeholder="Search SKU, name, category…"
            defaultValue={search}
            className="w-64"
          />
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
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">RRP</TableHead>
                <TableHead className="text-right">Trade price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No products match. {filter === "all" && "Run a sync to pull the 360 catalogue."}
                  </TableCell>
                </TableRow>
              )}
              {products.map((p: Product) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="max-w-md">
                    <Link
                      to={`/admin/products/${p.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.category}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {p.rrp_reference != null ? formatCurrency(Number(p.rrp_reference)) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {p.trade_price != null ? (
                      formatCurrency(Number(p.trade_price))
                    ) : (
                      <span className="text-destructive">not set</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.source === "portal" ? "—" : p.available_now}
                    {p.incoming.length > 0 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        +{p.incoming.reduce((sum, s) => sum + (s.qty || 0), 0)} inc.
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {p.discontinued_at ? (
                        <Badge variant="destructive">discontinued</Badge>
                      ) : p.active ? (
                        <Badge>active</Badge>
                      ) : (
                        <Badge variant="secondary">inactive</Badge>
                      )}
                      {p.source === "portal" && <Badge variant="outline">portal</Badge>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
