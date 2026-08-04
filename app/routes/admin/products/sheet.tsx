import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getSettings } from "~/lib/settings.server";
import { productPhoto, type Product } from "~/lib/products";
import { cn, exGst, formatCurrency, formatDate } from "~/lib/utils";

export function meta() {
  return [{ title: "Product sheet — Trade Portal" }];
}

type PriceMode = "trade" | "rrp" | "none";

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const url = new URL(request.url);
  const ids = url.searchParams
    .getAll("ids")
    .flatMap((v) => v.split(","))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
  if (ids.length === 0) {
    throw new Response("No products selected", { status: 400 });
  }
  const db = context.db;
  const products = await db<Product[]>`
    SELECT * FROM products WHERE id IN ${db(ids)} ORDER BY category, name
  `;
  const settings = await getSettings(context, [
    "company_name",
    "company_phone",
    "company_email",
    "company_abn",
  ]);
  const priceModeRaw = url.searchParams.get("prices");
  const priceMode: PriceMode =
    priceModeRaw === "rrp" || priceModeRaw === "none" ? priceModeRaw : "trade";
  // Strip whatever the chosen mode doesn't show — loader data is serialised
  // into the HTML, and sheets may be forwarded outside the business.
  const scrubbed = products.map((p: Product) => ({
    ...p,
    trade_price: priceMode === "trade" ? p.trade_price : null,
    rrp_reference: priceMode === "none" ? null : p.rrp_reference,
  }));
  return {
    products: scrubbed,
    priceMode,
    idsParam: ids.join(","),
    company: {
      name: settings.company_name || "The Furniture Shack — Trade",
      phone: settings.company_phone || "",
      email: settings.company_email || "",
      abn: settings.company_abn || "",
    },
    generatedAt: new Date().toISOString(),
  };
}

const PRICE_MODES: { key: PriceMode; label: string }[] = [
  { key: "trade", label: "Trade prices" },
  { key: "rrp", label: "RRP only" },
  { key: "none", label: "No prices" },
];

export default function ProductSheet() {
  const { products, priceMode, idsParam, company, generatedAt } =
    useLoaderData<typeof loader>();

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 print:max-w-none print:p-0">
      {/* Toolbar — never printed */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-4 py-3 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
        >
          Download PDF
        </button>
        <span className="text-sm text-muted-foreground">
          (opens your printer dialog — choose "Save as PDF")
        </span>
        <div className="ml-auto flex items-center gap-1">
          {PRICE_MODES.map((mode) => (
            <Link
              key={mode.key}
              to={`/admin/products/sheet?ids=${idsParam}&prices=${mode.key}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                priceMode === mode.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              {mode.label}
            </Link>
          ))}
        </div>
        <Link
          to="/admin/products"
          className="text-sm underline underline-offset-4"
        >
          Back
        </Link>
      </div>

      {/* Sheet header */}
      <header className="mb-6 flex items-end justify-between border-b-2 border-black pb-4">
        <div>
          <p className="text-xl font-bold uppercase tracking-widest">The Furniture Shack</p>
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-neutral-500">
            Trade
          </p>
        </div>
        <div className="text-right text-xs text-neutral-500">
          <p>{company.name}</p>
          {company.phone && <p>{company.phone}</p>}
          {company.email && <p>{company.email}</p>}
          <p>Prepared {formatDate(generatedAt)}</p>
        </div>
      </header>

      {/* Products */}
      <div className="flex flex-col gap-6">
        {products.map((p: Product) => {
          const trade = p.trade_price != null ? Number(p.trade_price) : null;
          const rrp = p.rrp_reference != null ? Number(p.rrp_reference) : null;
          return (
            <article
              key={p.id}
              className="flex gap-5 rounded-lg border border-neutral-200 p-4 break-inside-avoid"
            >
              <div className="h-40 w-40 shrink-0 overflow-hidden rounded-md bg-neutral-100">
                {productPhoto(p) ? (
                  <img src={productPhoto(p)} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl text-neutral-300">
                    ▪
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="text-xs uppercase tracking-wide text-neutral-500">{p.category}</p>
                <h2 className="text-lg font-semibold leading-snug">{p.name}</h2>
                <p className="font-mono text-xs text-neutral-500">{p.sku}</p>
                {p.dimensions && (
                  <p className="text-sm">
                    <span className="text-neutral-500">Dimensions:</span> {p.dimensions}
                  </p>
                )}
                {p.description && (
                  <p className="line-clamp-3 text-sm text-neutral-600">{p.description}</p>
                )}
                <div className="mt-auto pt-2">
                  {priceMode === "trade" && trade != null && (
                    <p className="text-xl font-bold">
                      {formatCurrency(exGst(trade))}{" "}
                      <span className="text-sm font-normal text-neutral-500">
                        ex GST ({formatCurrency(trade)} inc GST)
                      </span>
                      {rrp != null && (
                        <span className="ml-3 text-sm font-normal text-neutral-500">
                          RRP {formatCurrency(rrp)}
                        </span>
                      )}
                    </p>
                  )}
                  {priceMode === "trade" && trade == null && (
                    <p className="text-sm text-neutral-500">Price on application</p>
                  )}
                  {priceMode === "rrp" &&
                    (rrp != null ? (
                      <p className="text-xl font-bold">
                        {formatCurrency(rrp)}{" "}
                        <span className="text-sm font-normal text-neutral-500">RRP inc GST</span>
                      </p>
                    ) : (
                      <p className="text-sm text-neutral-500">Price on application</p>
                    ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="mt-8 border-t border-neutral-200 pt-3 text-center text-xs text-neutral-400">
        {company.name}
        {company.abn && <> · ABN {company.abn}</>} · Prices subject to change · Stock subject
        to availability
      </footer>
    </div>
  );
}
