import { useState } from "react";
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
import { addToCart, readCart, serializeCart } from "~/lib/cart.server";
import { getStoreProduct, scrubProductForPublic } from "~/lib/store.server";
import { getBundleComponents } from "~/lib/shopify.server";
import { getCustomer } from "~/lib/customer-auth.server";
import { getSetting } from "~/lib/settings.server";
import { stockStatus } from "~/lib/stock";
import { RichText } from "~/components/rich-text";
import { cn, exGst, formatCurrency, formatDate, formatDateTime } from "~/lib/utils";

export function meta({ data }: { data?: { product?: { name: string } } }) {
  return [{ title: `${data?.product?.name ?? "Product"} — The Furniture Shack Trade` }];
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const product = await getStoreProduct(context, params.sku ?? "");
  if (!product) throw new Response("Not found", { status: 404 });
  const customer = await getCustomer(context, request);
  const showPrices = Boolean(customer?.approved);
  const imageFit = (await getSetting(context, "product_image_fit")) === "cover" ? "cover" : "contain";
  // Bundle contents are public info (names + quantities, never prices).
  const contents =
    product.source === "shopify"
      ? (await getBundleComponents(context.db, product.id))
          .filter((c) => c.name)
          .map((c) => ({ name: c.name as string, quantity: c.quantity }))
      : [];
  return {
    product: showPrices ? product : scrubProductForPublic(product),
    contents,
    showPrices,
    imageFit,
    loggedIn: Boolean(customer),
  };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const customer = await getCustomer(context, request);
  if (!customer?.approved) throw redirect("/trade/login");
  const product = await getStoreProduct(context, params.sku ?? "");
  if (!product || product.trade_price == null) {
    throw new Response("Not available to order", { status: 400 });
  }
  const form = await request.formData();
  const qty = Math.max(1, Math.min(999, Math.trunc(Number(form.get("qty")) || 1)));
  const cart = addToCart(await readCart(context, request), product.sku, qty);
  return redirect(`/products/${encodeURIComponent(product.sku)}?added=${qty}`, {
    headers: { "Set-Cookie": await serializeCart(context, cart) },
  });
}

export default function StoreProduct() {
  const { product, contents, showPrices, imageFit, loggedIn } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const added = searchParams.get("added");
  const stock = stockStatus(product);
  const price = product.trade_price != null ? Number(product.trade_price) : null;
  // Shopify gallery photos are full-res; 360's image_url is low-res — when a
  // gallery exists, use it alone so the first photo is always sharp.
  const gallery =
    (product.images ?? []).length > 0
      ? [...new Set(product.images)]
      : [product.image_url].filter(Boolean);
  const [photo, setPhoto] = useState(0);
  const mainImage = gallery[Math.min(photo, gallery.length - 1)] ?? "";

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
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            <div className="aspect-square w-full">
              {mainImage ? (
                <img
                  src={mainImage}
                  alt={product.name}
                  className={
                    imageFit === "contain"
                      ? "h-full w-full bg-white object-contain p-3"
                      : "h-full w-full object-cover"
                  }
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-5xl text-muted-foreground/40">
                  ▪
                </div>
              )}
            </div>
          </div>
          {gallery.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {gallery.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setPhoto(i)}
                  className={cn(
                    "h-16 w-16 overflow-hidden rounded-md border bg-muted",
                    i === Math.min(photo, gallery.length - 1)
                      ? "border-2 border-primary"
                      : "border-border hover:border-primary/50",
                  )}
                  aria-label={`Photo ${i + 1} of ${product.name}`}
                >
                  <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
              {product.category}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{product.name}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">SKU {product.sku}</p>
          </div>

          {showPrices ? (
            <div className="rounded-lg border border-border bg-card p-5">
              {price != null ? (
                <>
                  <p className="text-3xl font-bold">
                    {formatCurrency(exGst(price))}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">ex GST</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatCurrency(price)} inc GST
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
              {price != null && (
                <Form method="post" className="mt-4 flex items-end gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="qty" className="text-xs font-medium text-muted-foreground">
                      Quantity
                    </label>
                    <input
                      id="qty"
                      name="qty"
                      type="number"
                      min={1}
                      max={999}
                      defaultValue={1}
                      className="h-10 w-20 rounded-md border border-input bg-card px-3 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={navigation.state !== "idle"}
                    className="h-10 rounded-md bg-brand px-6 text-sm font-semibold text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
                  >
                    Add to cart
                  </button>
                  {added && (
                    <Link to="/cart" className="text-sm font-medium text-brand underline underline-offset-4">
                      Added ✓ — view cart
                    </Link>
                  )}
                </Form>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-lg font-semibold">See your trade price</p>
              {loggedIn ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Your application is under review — pricing unlocks once approved.
                </p>
              ) : (
                <>
                  <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                    {[
                      "Trade discounts off RRP across the range",
                      "Live Brisbane warehouse stock + incoming ETAs",
                      "Order online, invoiced — no credit card needed",
                    ].map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex gap-3">
                    <Link
                      to="/trade/apply"
                      className="rounded-md bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground hover:bg-brand/90"
                    >
                      Apply for a trade account
                    </Link>
                    <Link
                      to="/trade/login"
                      className="rounded-md border border-input bg-card px-4 py-2.5 text-sm font-medium hover:bg-accent"
                    >
                      Trade login
                    </Link>
                  </div>
                </>
              )}
            </div>
          )}

          {showPrices && (
            <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
              {[
                ["Brisbane warehouse", "Wakerley — collect or deliver"],
                ["Invoiced ordering", "Pay by EFT or card, no fees on Visa/MC"],
                ["Trade support", "Real people, quick answers"],
              ].map(([title, sub]) => (
                <div key={title} className="rounded-md border border-border bg-card px-3 py-2.5">
                  <p className="font-semibold text-foreground">{title}</p>
                  <p className="mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
          )}

          {contents.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="font-semibold">What's included</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {contents.map((c, i) => (
                  <li key={i}>
                    {c.quantity} × {c.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      </div>

      <div className="grid gap-10 border-t border-border pt-10 lg:grid-cols-3">
        {product.description && (
          <div className="lg:col-span-2">
            <h2 className="text-xl font-semibold tracking-tight">About this piece</h2>
            <RichText text={product.description} className="mt-4 text-muted-foreground" />
          </div>
        )}
        <div className={product.description ? "" : "lg:col-span-3"}>
          <h2 className="text-xl font-semibold tracking-tight">Specifications</h2>
          <dl className="mt-4 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {specs
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
