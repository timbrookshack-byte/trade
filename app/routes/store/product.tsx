import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { getStoreProduct, scrubProductForPublic } from "~/lib/store.server";
import { getCustomer } from "~/lib/customer-auth.server";
import { stockStatus } from "~/lib/stock";
import { cn, exGst, formatCurrency, formatDate, formatDateTime } from "~/lib/utils";

export function meta({ data }: { data?: { product?: { name: string } } }) {
  return [{ title: `${data?.product?.name ?? "Product"} — The Furniture Shack Trade` }];
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const product = await getStoreProduct(context, params.sku ?? "");
  if (!product) throw new Response("Not found", { status: 404 });
  const customer = await getCustomer(context, request);
  const showPrices = Boolean(customer?.approved);
  return {
    product: showPrices ? product : scrubProductForPublic(product),
    showPrices,
    loggedIn: Boolean(customer),
  };
}

export default function StoreProduct() {
  const { product, showPrices, loggedIn } = useLoaderData<typeof loader>();
  const stock = stockStatus(product);
  const price = product.trade_price != null ? Number(product.trade_price) : null;

  const specs: [string, string][] = [
    ["SKU", product.sku],
    ["Dimensions", product.dimensions],
    ["Volume", product.cbm ? `${Number(product.cbm).toFixed(2)} m³` : ""],
    ["Weight", product.weight_kg ? `${Number(product.weight_kg)} kg` : ""],
  ];

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">
        <Link to="/products" className="underline-offset-4 hover:underline">
          Products
        </Link>{" "}
        /{" "}
        <Link
          to={`/products?category=${encodeURIComponent(product.category)}`}
          className="underline-offset-4 hover:underline"
        >
          {product.category}
        </Link>
      </p>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          <div className="aspect-square w-full">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-5xl text-muted-foreground/40">
                ▪
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {product.category}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{product.name}</h1>
          </div>

          {showPrices ? (
            <div className="rounded-lg border border-border bg-card p-5">
              {price != null ? (
                <>
                  <p className="text-3xl font-bold">
                    {formatCurrency(price)}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">inc GST</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatCurrency(exGst(price))} ex GST
                    {product.rrp_reference != null && (
                      <> · RRP {formatCurrency(Number(product.rrp_reference))}</>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Price on application — contact the trade team.</p>
              )}
              <div className="mt-4 flex items-center gap-3">
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-sm font-medium",
                    stock.kind === "in_stock" && "bg-green-600/10 text-green-800",
                    stock.kind === "low" && "bg-amber-500/15 text-amber-800",
                    stock.kind === "incoming" && "bg-blue-500/10 text-blue-800",
                    stock.kind === "out" && "bg-muted text-muted-foreground",
                  )}
                >
                  {stock.label}
                </span>
                {product.stock_synced_at && (
                  <span className="text-xs text-muted-foreground">
                    stock as at {formatDateTime(product.stock_synced_at)}
                  </span>
                )}
              </div>
              {product.incoming.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                  {product.incoming.map((s, i) => (
                    <li key={i}>
                      {s.qty} more due {formatDate(s.eta)} ({s.status})
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-sm text-muted-foreground">
                Ordering opens soon — in the meantime contact the trade team to place an order
                for this item.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="font-medium">Trade pricing available</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {loggedIn
                  ? "Your application is under review — pricing unlocks once approved."
                  : "Log in to see your trade price and current availability."}
              </p>
              {!loggedIn && (
                <div className="mt-4 flex gap-3">
                  <Link
                    to="/trade/login"
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Trade login
                  </Link>
                  <Link
                    to="/trade/apply"
                    className="rounded-md border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    Apply for trade
                  </Link>
                </div>
              )}
            </div>
          )}

          {product.description && (
            <p className="whitespace-pre-line text-muted-foreground">{product.description}</p>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border pt-4 text-sm">
            {specs
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
