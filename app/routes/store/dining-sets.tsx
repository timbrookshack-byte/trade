import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { listDiningSets } from "~/lib/dining.server";
import { getSetting } from "~/lib/settings.server";

export function meta() {
  return [
    { title: "Dining Sets — The Furniture Shack Trade" },
    {
      name: "description",
      content: "Build your dining set: choose the table, chair style and quantity.",
    },
  ];
}

export async function loader({ context }: LoaderFunctionArgs) {
  const [sets, imageFit] = await Promise.all([
    listDiningSets(context.db, { activeOnly: true }),
    getSetting(context, "product_image_fit"),
  ]);
  return {
    imageFit: imageFit === "cover" ? "cover" : "contain",
    sets: sets.map((s) => ({
      slug: s.slug,
      title: s.title,
      table: s.table_product_title,
      chairCount: s.chair_count,
      qtyOptions: s.qty_options,
      image: s.hero_image_url,
    })),
  };
}

export default function DiningSets() {
  const { sets, imageFit } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">
          Build your set
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Dining sets</h1>
        <p className="mt-2 max-w-xl text-lg text-muted-foreground">
          Pick a table, choose the chair style that suits the project, and set how many
          seats you need — pricing updates as you build.
        </p>
      </div>

      {sets.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          Dining sets are on their way — check back soon.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {sets.map((set) => (
            <Link
              key={set.slug}
              to={`/dining-sets/${encodeURIComponent(set.slug)}`}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-muted">
                {set.image ? (
                  <img
                    src={set.image}
                    alt={set.title}
                    loading="lazy"
                    className={
                      imageFit === "contain"
                        ? "h-full w-full bg-white object-contain p-2"
                        : "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    }
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-3xl text-muted-foreground/40">
                    ▪
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <p className="font-medium leading-snug group-hover:underline group-hover:underline-offset-4">
                  {set.title}
                </p>
                <p className="text-sm text-muted-foreground">
                  {set.chairCount} chair style{set.chairCount === 1 ? "" : "s"} · seats{" "}
                  {set.qtyOptions.join(" / ")}
                </p>
                <p className="mt-auto pt-2 text-sm font-medium text-brand">
                  Build this set →
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
