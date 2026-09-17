import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  redirect,
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
import { createOrder } from "~/lib/orders.server";
import { getSetting } from "~/lib/settings.server";
import { runShopifyBundleSync } from "~/lib/shopify.server";
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
  const discountPercent =
    Number(await getSetting(context, "trade_discount_percent")) || 37.5;
  const [products, categories, syncRuns] = await Promise.all([
    listProducts(context.db, filter, search, category, discountPercent),
    listAllCategories(context.db),
    getLastSyncRuns(context.db, 1),
  ]);
  return {
    products,
    categories,
    lastSync: syncRuns[0] ?? null,
    filter,
    search,
    category,
    discountPercent,
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const user = await requireUser(context, request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "sync") {
    const result = await runSync(context.db, "manual");
    return { syncResult: result };
  }
  if (intent === "sync-bundles") {
    const result = await runShopifyBundleSync(context.db, "manual");
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
  const ids = [
    ...new Set(
      form
        .getAll("ids")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  if (
    intent === "selected-activate" ||
    intent === "selected-deactivate" ||
    intent === "selected-price-default" ||
    intent === "selected-reprice-default" ||
    intent === "selected-sheet" ||
    intent === "selected-quote"
  ) {
    if (ids.length === 0) {
      return { bulkResult: "No products ticked — tick some rows first." };
    }
    if (intent === "selected-sheet") {
      throw redirect(`/admin/products/sheet?ids=${ids.join(",")}`);
    }
    if (intent === "selected-quote") {
      const db = context.db;
      const products = await db<
        { id: number; sku: string; name: string; trade_price: string | null }[]
      >`
        SELECT id, sku, name, trade_price FROM products WHERE id IN ${db(ids)}
        ORDER BY category, name
      `;
      const orderId = await createOrder(db, {
        status: "quote",
        created_by_user_id: user.id,
        lines: products.map((p: { id: number; sku: string; name: string; trade_price: string | null }) => ({
          product_id: p.id,
          sku: p.sku,
          name: p.name,
          quantity: 1,
          unit_price_inc_gst: Number(p.trade_price ?? 0),
        })),
      });
      throw redirect(`/admin/orders/${orderId}`);
    }
    const db = context.db;
    if (intent === "selected-deactivate") {
      const rows = await db<{ id: number }[]>`
        UPDATE products SET active = FALSE, auto_deactivated = FALSE, updated_at = now()
        WHERE id IN ${db(ids)} AND active RETURNING id
      `;
      return { bulkResult: `${rows.length} product(s) deactivated — hidden from the storefront.` };
    }
    if (intent === "selected-activate") {
      const rows = await db<{ id: number }[]>`
        UPDATE products SET active = TRUE, auto_deactivated = FALSE, updated_at = now()
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
    if (intent === "selected-reprice-default") {
      // Overwrites existing trade prices — for correcting prices that were
      // set while the feed's RRP was wrong (e.g. a retail promo price).
      const rows = await db<{ id: number }[]>`
        UPDATE products
        SET trade_price = round((rrp_reference * ${1 - discount / 100})::numeric, 2),
            updated_at = now()
        WHERE id IN ${db(ids)} AND source = 'shack360' AND rrp_reference IS NOT NULL
        RETURNING id
      `;
      return {
        bulkResult: `${rows.length} of ${ids.length} ticked re-priced at RRP − ${discount}% (bundles and portal products are untouched — bundle pricing recomputes from components).`,
      };
    }
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

/**
 * Ticked rows live in the browser, not the DOM of the current table: the
 * trade team builds a product sheet by searching, ticking, searching again,
 * and a GET navigation would otherwise wipe every earlier tick.
 */
const SELECTION_KEY = "tp.admin.products.selection";

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

  const [selected, setSelected] = useState<number[]>([]);
  const restored = useRef(false);
  // Restored after mount (not in the initial state) so server and client
  // render the same markup; sessionStorage keeps the working set through a
  // reload or a trip to a product's edit page, and clears with the tab.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SELECTION_KEY);
      const saved = raw ? JSON.parse(raw) : [];
      if (Array.isArray(saved)) {
        setSelected(saved.filter((n: unknown) => typeof n === "number"));
      }
    } catch {
      // Blocked storage — ticks still survive searches, just not a reload.
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(SELECTION_KEY, JSON.stringify(selected));
    } catch {
      // As above — nothing to do, the in-page selection still works.
    }
  }, [selected]);

  const selectedSet = new Set(selected);
  const visibleIds = products.map((p: Product) => p.id);
  const allVisibleTicked = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  // Ticked earlier, filtered out of the list now — these ride along as
  // hidden inputs so a bulk action still covers them.
  const offList = selected.filter((id) => !visibleIds.includes(id));

  function toggle(id: number, on: boolean) {
    setSelected((prev) => (on ? [...prev, id] : prev.filter((n) => n !== id)));
  }
  function toggleVisible(on: boolean) {
    setSelected((prev) =>
      on
        ? [...prev, ...visibleIds.filter((id) => !prev.includes(id))]
        : prev.filter((id) => !visibleIds.includes(id)),
    );
  }

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
          <Form method="post">
            <input type="hidden" name="intent" value="sync-bundles" />
            <Button type="submit" variant="outline" disabled={syncing}>
              Sync bundles
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
          {offList.map((id) => (
            <input key={id} type="hidden" name="ids" value={id} />
          ))}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {selected.length === 0 ? (
                "With ticked rows:"
              ) : (
                <>
                  <span className="font-medium text-foreground">{selected.length} ticked</span>
                  {offList.length > 0 && <> ({offList.length} not on this list)</>} —
                </>
              )}
            </p>
            <Button type="submit" name="intent" value="selected-activate" variant="outline" size="sm">
              Activate
            </Button>
            <Button type="submit" name="intent" value="selected-deactivate" variant="outline" size="sm">
              Deactivate
            </Button>
            <Button type="submit" name="intent" value="selected-price-default" variant="outline" size="sm">
              Price at default (unpriced only)
            </Button>
            <Button type="submit" name="intent" value="selected-reprice-default" variant="outline" size="sm">
              Re-price at default (overwrites)
            </Button>
            <Button type="submit" name="intent" value="selected-sheet" variant="outline" size="sm">
              Product sheet
            </Button>
            <Button type="submit" name="intent" value="selected-quote" variant="outline" size="sm">
              Create quote
            </Button>
            {selected.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected([])}
                className="text-muted-foreground"
              >
                Clear ticks
              </Button>
            )}
            <p className="w-full text-xs text-muted-foreground">
              Ticks are kept as you search and filter — search, tick, search again, then build
              the sheet or quote from everything you've ticked.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all on this list"
                    className="size-4 accent-primary"
                    checked={allVisibleTicked}
                    onChange={(e) => toggleVisible(e.currentTarget.checked)}
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
                      checked={selectedSet.has(p.id)}
                      onChange={(e) => toggle(p.id, e.currentTarget.checked)}
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
                        <Badge variant="secondary">
                          {p.auto_deactivated ? "inactive — no stock" : "inactive"}
                        </Badge>
                      )}
                      {p.source === "portal" && <Badge variant="outline">portal</Badge>}
                      {p.source === "shopify" && <Badge variant="outline">bundle</Badge>}
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
