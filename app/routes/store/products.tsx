import { Form, Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { listCategories, listStoreProducts, scrubProductForPublic } from "~/lib/store.server";
import { getCustomer } from "~/lib/customer-auth.server";
import { getSetting } from "~/lib/settings.server";
import { ProductCard } from "~/components/product-card";
import type { Product } from "~/lib/products";
import { cn } from "~/lib/utils";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "Products — The Furniture Shack Trade" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "";
  const search = url.searchParams.get("q") ?? "";
  const [products, categories, customer, imageFit] = await Promise.all([
    listStoreProducts(context, { category, search }),
    listCategories(context),
    getCustomer(context, request),
    getSetting(context, "product_image_fit"),
  ]);
  const showPrices = Boolean(customer?.approved);
  return {
    imageFit: imageFit === "cover" ? "cover" : "contain",
    products: showPrices ? products : products.map(scrubProductForPublic),
    categories: categories.map((c) => c.category),
    category,
    search,
    showPrices,
    loggedIn: Boolean(customer),
  };
}

export default function StoreProducts() {
  const { products, categories, category, search, showPrices, loggedIn, imageFit } =
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
          {products.map((p: Product) => (
            <ProductCard key={p.id} product={p} showPrices={showPrices} imageFit={imageFit} />
          ))}
        </div>
      )}
    </div>
  );
}
