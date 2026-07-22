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
import {
  activatePriced,
  applyDefaultPricing,
  listAllCategories,
  listProducts,
} from "~/lib/products.server";
import { getSetting } from "~/lib/settings.server";
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
  const category = url.searchParams.get("category") ?? "";
  const [products, categories, syncRuns, discountSetting] = await Promise.all([
    listProducts(context.db, filter, search, category),
    listAllCategories(context.db),
    getLastSyncRuns(context.db, 1),
    getSetting(context, "trade_discount_percent"),
  ]);
  return {
    products,
    categories,
    lastSync: syncRuns[0] ?? null,
    filter,
    search,
    category,
    discountPercent: Number(discountSetting) || 37.5,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "sync") {
    const result = await runSync(context.db, "manual");
    return { syncResult: result };
  }
  if (intent === "price-defaults") {
    const discount = Number(await getSetting(context, "trade_discount_percent")) || 37.5;
    const count = await applyDefaultPricing(context.db, discount);
    return { bulkResult: `Default pricing (RRP − ${discount}%) applied to ${count} product(s).` };
  }
  if (intent === "activate-priced") {
    const count = await activatePriced(context.db);
    return { bulkResult: `${count} priced product(s) activated — now live on the storefront.` };
  }

  // Actions on ticked rows.
  const ids = form
    .getAll("ids")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (intent === "selected-activate" || intent === "selected-deactivate" || intent === "selected-price-default") {
    if (ids.length === 0) {
      return { bulkResult: "No products ticked — tick some rows first." };
    }
    const db = context.db;
    if (intent === "selected-deactivate") {
      const rows = await db<{ id: number }[]>`
        UPDATE products SET active = FALSE, updated_at = now()
        WHERE id IN ${db(ids)} AND active RETURNING id
      `;
      return { bulkResult: `${rows.length} product(s) deactivated — hidden from the storefront.` };
    }
    if (intent === "selected-activate") {
      const rows = await db<{ id: number }[]>`
        UPDATE products SET active = TRUE, updated_at = now()
        WHERE id IN ${db(ids)} AND NOT active
          AND trade_price IS NOT NULL AND discontinued_at IS NULL
        RETURNING id
      `;
      const skipped = ids.length - rows.length;
      return {
        bulkResult: `${rows.length} product(s) activated.${
          skipped > 0 ? ` ${skipped} skipped (no trade price, discontinued, or already active).` : ""
        }`,
      };
    }
    const discount = Number(await getSetting(context, "trade_discount_percent")) || 37.5;
    const rows = await db<{ id: number }[]>`
      UPDATE products
      SET trade_price = round(rrp_reference * ${1 - discount / 100}, 2), updated_at = now()
      WHERE id IN ${db(ids)} AND source = 'shack360'
        AND trade_price IS NULL AND rrp_reference IS NOT NULL
      RETURNING id
    `;
    return {
      bulkResult: `Default pricing applied to ${rows.length} of ${ids.length} ticked (already-priced or portal products are untouched).`,
    };
  }
  return null;
}

export default function ProductsList() {
  const { products, categories, lastSync, filter, search, category, discountPercent } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const actionData = useActionData<typeof action>();
  const syncing =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "sync";
  const syncResult = navigation.state === "idle" ? actionData?.syncResult : undefined;
  const bulkResult = navigation.state === "idle" ? actionData?.bulkResult : undefined;
  const unpricedCount = products.filter(
    (p: Product) => p.source === "shack360" && p.trade_price == null && p.rrp_reference != null,
  ).length;

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
      {bulkResult && <Alert variant="success">{bulkResult}</Alert>}

      {(filter === "new" || filter === "inactive" || filter === "all") && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Bulk pricing{unpricedCount > 0 && <> — {unpricedCount} shown here have no trade price</>}:
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="price-defaults" />
            <Button type="submit" variant="outline" size="sm" disabled={syncing}>
              Price all unpriced at RRP − {discountPercent}%
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="activate-priced" />
            <Button type="submit" variant="outline" size="sm" disabled={syncing}>
              Activate all priced products
            </Button>
          </Form>
        </div>
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
          <select
            name="category"
            defaultValue={category}
            className="h-10 rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((cat: string) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <Input
            name="q"
            placeholder="Search SKU or name…"
            defaultValue={search}
            className="w-56"
          />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </Form>
      </div>

      <Form method="post">
      <Card>
        <CardContent className="pt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">With ticked rows:</p>
            <Button type="submit" name="intent" value="selected-activate" variant="outline" size="sm">
              Activate
            </Button>
            <Button type="submit" name="intent" value="selected-deactivate" variant="outline" size="sm">
              Deactivate
            </Button>
            <Button type="submit" name="intent" value="selected-price-default" variant="outline" size="sm">
              Price at default (unpriced only)
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-4 accent-primary"
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      e.currentTarget.form
                        ?.querySelectorAll<HTMLInputElement>('input[name="ids"]')
                        .forEach((el) => {
                          el.checked = checked;
                        });
                    }}
                  />
                </TableHead>
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
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No products match. {filter === "all" && "Run a sync to pull the 360 catalogue."}
                  </TableCell>
                </TableRow>
              )}
              {products.map((p: Product) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      name="ids"
                      value={p.id}
                      aria-label={`Select ${p.sku}`}
                      className="size-4 accent-primary"
                    />
                  </TableCell>
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
      </Form>
    </div>
  );
}
