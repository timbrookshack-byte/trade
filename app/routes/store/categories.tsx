import { useMemo, useState } from "react";
import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Search } from "lucide-react";
import { listCategories } from "~/lib/store.server";
import { getDiningCategoryTile } from "~/lib/dining.server";

export function meta() {
  return [
    { title: "Categories — The Furniture Shack Trade" },
    { name: "description", content: "Browse the full range by category." },
  ];
}

const STOPWORDS = new Set([
  "the", "and", "with", "for", "set", "pack", "piece", "range", "collection",
]);

function keywordsFrom(names: string[]): string[] {
  const words = new Set<string>();
  for (const name of names) {
    for (const raw of name.toLowerCase().split(/[^a-z]+/)) {
      if (raw.length >= 3 && !STOPWORDS.has(raw)) words.add(raw);
      if (words.size >= 120) return [...words];
    }
  }
  return [...words];
}

export async function loader({ context }: LoaderFunctionArgs) {
  const db = context.db;
  const [categories, diningTile, productNames, setNames] = await Promise.all([
    listCategories(context),
    getDiningCategoryTile(db),
    // Product names per DISPLAY category (primary + extra categories) power
    // the search: "chair" finds every category containing chairs.
    db<{ category: string; name: string }[]>`
      SELECT COALESCE(NULLIF(cs.display_name, ''), pc.category) AS category, pc.name
      FROM (
        SELECT p.category, p.name FROM products p
        WHERE p.active AND p.discontinued_at IS NULL
        UNION ALL
        SELECT ec.value, p.name
        FROM products p, jsonb_array_elements_text(p.extra_categories) ec(value)
        WHERE p.active AND p.discontinued_at IS NULL
      ) pc
      LEFT JOIN category_settings cs ON cs.category = pc.category
      WHERE pc.category <> '' AND COALESCE(cs.hidden, FALSE) = FALSE
    `,
    db<{ name: string }[]>`
      SELECT title AS name FROM dining_sets WHERE active AND discontinued_at IS NULL
      UNION ALL
      SELECT DISTINCT chair_product_title FROM dining_set_chairs
    `,
  ]);

  const namesByCategory = new Map<string, string[]>();
  for (const row of productNames) {
    const list = namesByCategory.get(row.category) ?? [];
    list.push(row.name);
    namesByCategory.set(row.category, list);
  }

  const tiles = categories.map((c) => ({
    ...c,
    href: `/products?category=${encodeURIComponent(c.category)}`,
    keywords: keywordsFrom(namesByCategory.get(c.category) ?? []),
  }));
  if (diningTile) {
    tiles.push({
      ...diningTile,
      href: "/dining-sets",
      keywords: keywordsFrom([
        "dining table chairs outdoor commercial sets builder",
        ...setNames.map((r: { name: string }) => r.name),
      ]),
    });
  }
  tiles.sort(
    (a, b) =>
      Number(b.featured) - Number(a.featured) || a.category.localeCompare(b.category),
  );
  return { tiles };
}

type Tile = Awaited<ReturnType<typeof loader>>["tiles"][number];

/** Every query term must match the name or a product keyword; name hits rank first. */
function matchTiles(tiles: Tile[], query: string): Tile[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return tiles;
  const scored = tiles.flatMap((tile) => {
    const name = tile.category.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (name.includes(term)) score += 2;
      else if (tile.keywords.some((k: string) => k.startsWith(term))) score += 1;
      else return [];
    }
    return [{ tile, score }];
  });
  scored.sort(
    (a, b) => b.score - a.score || a.tile.category.localeCompare(b.tile.category),
  );
  return scored.map((s) => s.tile);
}

export default function CategoriesPage() {
  const { tiles } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const results = useMemo(() => matchTiles(tiles, query), [tiles, query]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-brand">
          Browse the range
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Categories</h1>
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search categories — try “chairs”, “outdoor”, “marble”…"
          autoComplete="off"
          className="h-12 w-full rounded-full border border-input bg-card pl-11 pr-4 text-base outline-none focus:border-brand"
        />
      </div>

      {searching ? (
        results.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <p>No categories match “{query.trim()}”.</p>
            <Link
              to={`/products?q=${encodeURIComponent(query.trim())}`}
              className="mt-2 inline-block font-medium text-brand underline underline-offset-4"
            >
              Search all products for “{query.trim()}” instead →
            </Link>
          </div>
        ) : (
          <div className="flex max-w-2xl flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {results.map((tile) => (
              <Link
                key={tile.category}
                to={tile.href}
                className="group flex items-center gap-4 px-4 py-3 hover:bg-accent"
              >
                <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {tile.image_url && (
                    <img
                      src={tile.image_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full bg-white object-contain"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium group-hover:underline group-hover:underline-offset-4">
                    {tile.category}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {tile.product_count} item{tile.product_count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="text-muted-foreground group-hover:text-brand">→</span>
              </Link>
            ))}
          </div>
        )
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Link
              key={tile.category}
              to={tile.href}
              className={
                tile.featured
                  ? "group relative col-span-2 overflow-hidden rounded-lg border border-border bg-card"
                  : "group relative overflow-hidden rounded-lg border border-border bg-card"
              }
            >
              <div
                className={
                  tile.featured
                    ? "aspect-[8/3] w-full overflow-hidden bg-muted"
                    : "aspect-[4/3] w-full overflow-hidden bg-muted"
                }
              >
                {tile.image_url ? (
                  <img
                    src={tile.image_url}
                    alt={tile.category}
                    loading="lazy"
                    className={
                      tile.image_fit === "contain"
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
                  {tile.category}
                </span>
                <span className="text-xs text-muted-foreground">{tile.product_count}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
