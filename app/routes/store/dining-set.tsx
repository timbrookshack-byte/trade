import { useMemo, useState } from "react";
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
import { getDiningSet } from "~/lib/dining.server";
import { listProductsBySkus } from "~/lib/store.server";
import { scrubProductForPublic } from "~/lib/store.server";
import { getCustomer } from "~/lib/customer-auth.server";
import { addToCart, readCart, serializeCart } from "~/lib/cart.server";
import { productPhoto, type Product } from "~/lib/products";
import { stockStatus } from "~/lib/stock";
import { RichText } from "~/components/rich-text";
import { cn, exGst, formatCurrency, formatDateTime } from "~/lib/utils";

export function meta({ data }: { data?: { set?: { title: string } } }) {
  return [{ title: `${data?.set?.title ?? "Dining set"} — The Furniture Shack Trade` }];
}

interface VariantRef {
  sku: string;
  title: string;
}

async function loadSet(context: any, slug: string) {
  const data = await getDiningSet(context.db, slug);
  if (!data || !data.set.active || data.set.discontinued_at) {
    throw new Response("Not found", { status: 404 });
  }
  return data;
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { set, chairs } = await loadSet(context, params.slug ?? "");
  const customer = await getCustomer(context, request);
  const showPrices = Boolean(customer?.approved);

  // Resolve every table/chair variant SKU against the portal catalogue —
  // pricing and Wakerley stock come from here, never from Shopify.
  const allSkus = [
    ...set.table_skus.map((v: VariantRef) => v.sku),
    ...chairs.flatMap((c) => c.chair_skus.map((v: VariantRef) => v.sku)),
  ];
  const products = await listProductsBySkus(context, [...new Set(allSkus)]);
  const bySku = new Map(products.map((p) => [p.sku.toUpperCase(), p]));
  const keep = (variants: VariantRef[]) =>
    variants.filter((v) => bySku.has(v.sku.toUpperCase()));

  return {
    set: {
      slug: set.slug,
      title: set.title,
      table_product_title: set.table_product_title,
      table_skus: keep(set.table_skus),
      qty_options: set.qty_options,
      default_qty: set.default_qty,
      hero_image_url: set.hero_image_url,
    },
    chairs: chairs
      .map((c) => ({
        id: c.id,
        title: c.chair_product_title,
        chair_skus: keep(c.chair_skus),
        hero_image_url: c.hero_image_url,
        tile_image_url: c.tile_image_url,
      }))
      .filter((c) => c.chair_skus.length > 0),
    // Loader data is serialised into HTML — scrub prices/stock for the public.
    products: Object.fromEntries(
      products.map((p) => [p.sku, showPrices ? p : scrubProductForPublic(p)]),
    ),
    showPrices,
    loggedIn: Boolean(customer),
  };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const customer = await getCustomer(context, request);
  if (!customer?.approved) throw redirect("/trade/login");
  const { set, chairs } = await loadSet(context, params.slug ?? "");

  const form = await request.formData();
  const tableSku = String(form.get("table_sku") ?? "");
  const chairSku = String(form.get("chair_sku") ?? "");
  const qty = Math.trunc(Number(form.get("qty")));

  // Validate the configuration against the synced set definition.
  const validTable = set.table_skus.some((v: VariantRef) => v.sku === tableSku);
  const validChair = chairs.some((c) => c.chair_skus.some((v: VariantRef) => v.sku === chairSku));
  const validQty = set.qty_options.includes(qty);
  if (!validTable || !validChair || !validQty) {
    throw new Response("Invalid configuration", { status: 400 });
  }
  const products = await listProductsBySkus(context, [tableSku, chairSku]);
  if (products.length !== 2 || products.some((p) => p.trade_price == null)) {
    throw new Response("Not available to order", { status: 400 });
  }

  // Two REAL line items — the set itself is never carted (spec §5.4).
  let cart = await readCart(context, request);
  cart = addToCart(cart, tableSku, 1);
  cart = addToCart(cart, chairSku, qty);
  return redirect(`/dining-sets/${encodeURIComponent(set.slug)}?added=1`, {
    headers: { "Set-Cookie": await serializeCart(context, cart) },
  });
}

function StockLine({ label, product }: { label: string; product: Product }) {
  const stock = stockStatus(product);
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "rounded-full px-2.5 py-0.5 text-xs font-medium",
          stock.kind === "in_stock" && "bg-green-600/10 text-green-800",
          stock.kind === "low" && "bg-amber-500/15 text-amber-800",
          stock.kind === "incoming" && "bg-blue-500/10 text-blue-800",
          stock.kind === "out" && "bg-muted text-muted-foreground",
        )}
      >
        {stock.label}
      </span>
    </p>
  );
}

export default function DiningSetPage() {
  const { set, chairs, products, showPrices, loggedIn } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const added = searchParams.get("added");

  const productFor = (sku: string): Product | undefined => (products as any)[sku];

  // Default chair variant: first with stock, else the first (spec §5.1).
  const bestVariant = (variants: VariantRef[]) => {
    const withStock = variants.find((v) => {
      const p = productFor(v.sku);
      return p && (p.available_now > 0 || (p.incoming ?? []).length > 0);
    });
    return (withStock ?? variants[0])?.sku ?? "";
  };

  const [chairIdx, setChairIdx] = useState(0);
  const chair = chairs[Math.min(chairIdx, chairs.length - 1)];
  const [chairSkuBySet, setChairSkuBySet] = useState<Record<number, string>>({});
  const chairSku = chair
    ? chairSkuBySet[chair.id] ?? bestVariant(chair.chair_skus)
    : "";
  const [tableSku, setTableSku] = useState(set.table_skus[0]?.sku ?? "");
  const [qty, setQty] = useState(set.default_qty || set.qty_options[0]);

  const tableProduct = productFor(tableSku);
  const chairProduct = productFor(chairSku);

  const hero =
    chair?.hero_image_url ||
    (chairProduct && productPhoto(chairProduct)) ||
    set.hero_image_url ||
    (tableProduct && productPhoto(tableProduct)) ||
    "";

  const price = useMemo(() => {
    if (!showPrices) return null;
    const table = tableProduct?.trade_price != null ? Number(tableProduct.trade_price) : null;
    const chairP = chairProduct?.trade_price != null ? Number(chairProduct.trade_price) : null;
    if (table == null || chairP == null) return null;
    return table + chairP * qty;
  }, [showPrices, tableProduct, chairProduct, qty]);

  const rrp = useMemo(() => {
    const table =
      tableProduct?.rrp_reference != null ? Number(tableProduct.rrp_reference) : null;
    const chairP =
      chairProduct?.rrp_reference != null ? Number(chairProduct.rrp_reference) : null;
    if (table == null || chairP == null) return null;
    return table + chairP * qty;
  }, [tableProduct, chairProduct, qty]);

  const orderable = Boolean(tableProduct && chairProduct && price != null);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">
        <Link to="/dining-sets" className="underline-offset-4 hover:underline">
          Dining sets
        </Link>{" "}
        / {set.title}
      </p>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          <div className="aspect-square w-full">
            {hero ? (
              <img src={hero} alt={set.title} className="h-full w-full bg-white object-contain p-3" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-5xl text-muted-foreground/40">
                ▪
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
              Dining set builder
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">{set.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {set.table_product_title} + your choice of chairs
            </p>
          </div>

          {set.table_skus.length > 1 && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Table option</p>
              <select
                value={tableSku}
                onChange={(e) => setTableSku(e.target.value)}
                className="h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm"
              >
                {set.table_skus.map((v: VariantRef) => (
                  <option key={v.sku} value={v.sku}>
                    {v.title || v.sku}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Chair style</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {chairs.map((c, i) => {
                const firstChair = productFor(c.chair_skus[0]?.sku ?? "");
                const tile =
                  c.tile_image_url || (firstChair && productPhoto(firstChair)) || c.hero_image_url;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setChairIdx(i)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border p-2 text-center",
                      i === chairIdx
                        ? "border-2 border-brand"
                        : "border-border hover:border-brand/50",
                    )}
                  >
                    <span className="h-14 w-14 overflow-hidden rounded bg-muted">
                      {tile && (
                        <img src={tile} alt="" loading="lazy" className="h-full w-full bg-white object-contain" />
                      )}
                    </span>
                    <span className="text-[11px] leading-tight">{c.title}</span>
                  </button>
                );
              })}
            </div>
            {chair && chair.chair_skus.length > 1 && (
              <select
                value={chairSku}
                onChange={(e) =>
                  setChairSkuBySet((prev) => ({ ...prev, [chair.id]: e.target.value }))
                }
                className="mt-3 h-10 w-full max-w-xs rounded-md border border-input bg-card px-3 text-sm"
              >
                {chair.chair_skus.map((v: VariantRef) => (
                  <option key={v.sku} value={v.sku}>
                    {v.title || v.sku}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">How many chairs?</p>
            <div className="flex gap-2">
              {set.qty_options.map((n: number) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQty(n)}
                  className={cn(
                    "h-10 w-14 rounded-md border text-sm font-semibold",
                    n === qty
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border bg-card hover:border-brand/50",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
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
                    {rrp != null && rrp > price && <> · RRP {formatCurrency(rrp)}</>}
                    {" · "}table + {qty} × chair
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  This combination isn't priced yet — contact the trade team.
                </p>
              )}
              <div className="mt-4 space-y-1.5">
                {tableProduct && <StockLine label="Table" product={tableProduct} />}
                {chairProduct && <StockLine label="Chairs" product={chairProduct} />}
                {tableProduct?.stock_synced_at && (
                  <p className="text-xs text-muted-foreground">
                    stock as at {formatDateTime(tableProduct.stock_synced_at)}
                  </p>
                )}
              </div>
              {orderable && (
                <Form method="post" className="mt-4 flex items-center gap-3">
                  <input type="hidden" name="table_sku" value={tableSku} />
                  <input type="hidden" name="chair_sku" value={chairSku} />
                  <input type="hidden" name="qty" value={qty} />
                  <button
                    type="submit"
                    disabled={navigation.state !== "idle"}
                    className="h-10 rounded-md bg-brand px-6 text-sm font-semibold text-brand-foreground hover:bg-brand/90 disabled:opacity-50"
                  >
                    Add set to cart
                  </button>
                  {added && (
                    <Link
                      to="/cart"
                      className="text-sm font-medium text-brand underline underline-offset-4"
                    >
                      Added ✓ — view cart
                    </Link>
                  )}
                </Form>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Added as two lines — the table and your chairs — so your invoice shows
                exactly what ships.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-5">
              <p className="text-lg font-semibold">See your trade price</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {loggedIn
                  ? "Your application is under review — pricing unlocks once approved."
                  : "Trade customers see live pricing and Brisbane stock for every combination."}
              </p>
              {!loggedIn && (
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
              )}
            </div>
          )}
        </div>
      </div>

      {(tableProduct?.description || chairProduct?.description) && (
        <div className="grid gap-10 border-t border-border pt-10 lg:grid-cols-2">
          {tableProduct?.description && (
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                About the table — {set.table_product_title}
              </h2>
              <RichText text={tableProduct.description} className="mt-4 text-muted-foreground" />
            </div>
          )}
          {chairProduct?.description && chair && (
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                About the chairs — {chair.title}
              </h2>
              <RichText text={chairProduct.description} className="mt-4 text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
