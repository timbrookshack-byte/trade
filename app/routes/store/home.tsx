import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { listCategories } from "~/lib/store.server";
import { getDiningCategoryTile } from "~/lib/dining.server";
import { getCustomer } from "~/lib/customer-auth.server";

export function meta() {
  return [
    { title: "The Furniture Shack — Trade Portal" },
    {
      name: "description",
      content:
        "Wholesale furniture for retailers, designers and commercial projects. Trade pricing, live availability and 24/7 online ordering.",
    },
  ];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const [categories, diningTile, customer] = await Promise.all([
    listCategories(context),
    getDiningCategoryTile(context.db),
    getCustomer(context, request),
  ]);
  const tiles = categories.map((c) => ({
    ...c,
    href: `/products?category=${encodeURIComponent(c.category)}`,
  }));
  if (diningTile) tiles.push({ ...diningTile, href: "/dining-sets" });
  // Featured categories lead the grid as double-width tiles.
  tiles.sort(
    (a, b) =>
      Number(b.featured) - Number(a.featured) || a.category.localeCompare(b.category),
  );
  return { categories: tiles, loggedIn: Boolean(customer) };
}

const BENEFITS = [
  {
    title: "Order any time",
    body: "Browse the full range with your trade pricing and place orders 24/7 — no phone calls or emailed spreadsheets.",
  },
  {
    title: "Live availability",
    body: "See what's in the Wakerley warehouse and what's incoming with ETAs, so you can commit to client deadlines with confidence.",
  },
  {
    title: "Backed by a real team",
    body: "Proper GST invoices on every order, and the trade team just a phone call away when a project needs a hand.",
  },
];

export default function Home() {
  const { categories, loggedIn } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col items-start gap-5 pt-6 sm:pt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Wholesale furniture, direct to trade
        </p>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          The Furniture Shack range, at trade prices.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          For retailers, interior designers and commercial projects — the full catalogue,
          regularly synced availability, and online ordering around the clock.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/products"
            className="rounded-md bg-primary px-5 py-3 font-medium text-primary-foreground hover:bg-primary/90"
          >
            Browse the range
          </Link>
          {!loggedIn && (
            <Link
              to="/trade/apply"
              className="rounded-md bg-brand px-5 py-3 font-medium text-brand-foreground hover:bg-brand/90"
            >
              Apply for a trade account
            </Link>
          )}
        </div>
      </section>

      {categories.length > 0 && (
        <section className="flex flex-col gap-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl font-semibold tracking-tight">Shop by category</h2>
            <Link to="/products" className="text-sm underline-offset-4 hover:underline">
              View all products
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {categories.map((cat) => (
              <Link
                key={cat.category}
                to={cat.href}
                className={
                  cat.featured
                    ? "group relative col-span-2 overflow-hidden rounded-lg border border-border bg-card"
                    : "group relative overflow-hidden rounded-lg border border-border bg-card"
                }
              >
                <div
                  className={
                    cat.featured
                      ? "aspect-[8/3] w-full overflow-hidden bg-muted"
                      : "aspect-[4/3] w-full overflow-hidden bg-muted"
                  }
                >
                  {cat.image_url ? (
                    <img
                      src={cat.image_url}
                      alt={cat.category}
                      loading="lazy"
                      className={
                        cat.image_fit === "contain"
                          ? "h-full w-full bg-white object-contain p-2"
                          : "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      }
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-4xl text-muted-foreground/40">
                      ▪
                    </div>
                  )}
                </div>
                <div className="flex items-baseline justify-between px-4 py-3">
                  <span className="font-medium group-hover:underline group-hover:underline-offset-4">
                    {cat.category}
                  </span>
                  <span className="text-xs text-muted-foreground">{cat.product_count}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loggedIn && (
        <section className="rounded-lg border border-border bg-card p-8">
          <h2 className="text-2xl font-semibold tracking-tight">A portal built for trade</h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-3">
            {BENEFITS.map((b) => (
              <div key={b.title}>
                <h3 className="font-semibold">{b.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{b.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-muted-foreground">
            Trade accounts are open to businesses with an ABN in furniture retail, interior
            design, and commercial or hospitality fit-out.{" "}
            <Link
              to="/trade/apply"
              className="font-medium text-brand underline underline-offset-4"
            >
              Apply now
            </Link>{" "}
            — most applications are reviewed within one business day.
          </p>
        </section>
      )}
    </div>
  );
}
