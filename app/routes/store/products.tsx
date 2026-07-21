import { Form, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { listCategories, listStoreProducts, scrubProductForPublic } from "~/lib/store.server";
import { getCustomer } from "~/lib/customer-auth.server";
import { stockStatus } from "~/lib/stock";
import type { Product } from "~/lib/products";
import { cn, formatCurrency } from "~/lib/utils";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "Products — The Furniture Shack Trade" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "";
  const search = url.searchParams.get("q") ?? "";
  const [products, categories, customer] = await Promise.all([
    listStoreProducts(context, { category, search }),
    listCategories(context),
    getCustomer(context, request),
  ]);
  const showPrices = Boolean(customer?.approved);
  return {
    products: showPrices ? products : products.map(scrubProductForPublic),
    categories: categories.map((c) => c.category),
    category,
    search,
    showPrices,
    loggedIn: Boolean(customer),
  };
}

function stockBadgeClass(kind: string) {
  switch (kind) {
    case "in_stock":
      return "bg-green-600/10 text-green-800";
    case "low":
      return "bg-amber-500/15 text-amber-800";
    case "incoming":
      return "bg-blue-500/10 text-blue-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function StoreProducts() {
  const { products, categories, category, search, showPrices, loggedIn } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {category || "All products"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {products.length} product{products.length === 1 ? "" : "s"}
          {!loggedIn && (
            <>
              {" "}
              ·{" "}
              <Link to="/trade/login" className="underline underline-offset-4">
                log in
              </Link>{" "}
              or{" "}
              <Link to="/trade/apply" className="underline underline-offset-4">
                apply
              </Link>{" "}
              to see trade pricing
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/products"
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm",
            !category
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card hover:bg-accent",
          )}
        >
          All
        </Link>
        {categories.map((cat) => (
          <Link
            key={cat}
            to={`/products?category=${encodeURIComponent(cat)}`}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm",
              category === cat
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            {cat}
          </Link>
        ))}
        <Form method="get" className="ml-auto flex gap-2">
          {category && <input type="hidden" name="category" value={category} />}
          <Input name="q" placeholder="Search products…" defaultValue={search} className="w-56" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </Form>
      </div>

      {products.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          No products found{search && <> for “{search}”</>}.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p: Product) => {
            const stock = stockStatus(p);
            return (
              <Link
                key={p.id}
                to={`/products/${encodeURIComponent(p.sku)}`}
                className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="aspect-square w-full overflow-hidden bg-muted">
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl text-muted-foreground/40">
                      ▪
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {p.category}
                  </p>
                  <p className="font-medium leading-snug group-hover:underline group-hover:underline-offset-4">
                    {p.name}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    {showPrices ? (
                      <div>
                        {p.trade_price != null && (
                          <p className="font-semibold">
                            {formatCurrency(Number(p.trade_price))}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              inc GST
                            </span>
                          </p>
                        )}
                        {p.rrp_reference != null && (
                          <p className="text-xs text-muted-foreground">
                            RRP {formatCurrency(Number(p.rrp_reference))}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Trade price on login</p>
                    )}
                    {showPrices && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          stockBadgeClass(stock.kind),
                        )}
                      >
                        {stock.label}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
