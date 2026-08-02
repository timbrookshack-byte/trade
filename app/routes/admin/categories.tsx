import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Alert } from "~/components/ui/alert";
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
  return [{ title: "Categories — Trade Portal" }];
}

interface CategoryRow {
  category: string;
  active_count: number;
  total_count: number;
  display_name: string;
  hidden: boolean;
  image_url: string;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  // Union of categories that exist on products AND manually-added ones that
  // only live in category_settings (pre-created before assigning products).
  const categories = await context.db<CategoryRow[]>`
    SELECT cat.category,
           COALESCE(counts.active_count, 0)::int AS active_count,
           COALESCE(counts.total_count, 0)::int AS total_count,
           COALESCE(cs.display_name, '') AS display_name,
           COALESCE(cs.hidden, FALSE) AS hidden,
           COALESCE(cs.image_url, '') AS image_url
    FROM (
      SELECT category FROM products WHERE category <> ''
      UNION
      SELECT category FROM category_settings
    ) cat
    LEFT JOIN category_settings cs ON cs.category = cat.category
    LEFT JOIN (
      SELECT category,
             count(*) FILTER (WHERE active AND discontinued_at IS NULL) AS active_count,
             count(*) AS total_count
      FROM products WHERE category <> ''
      GROUP BY category
    ) counts ON counts.category = cat.category
    ORDER BY cat.category
  `;
  return { categories };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  if (intent === "add") {
    const name = String(form.get("new_category") ?? "").trim();
    if (!name) return { error: "Enter a category name." };
    await context.db`
      INSERT INTO category_settings (category) VALUES (${name})
      ON CONFLICT (category) DO NOTHING
    `;
    return { ok: `Category "${name}" added — assign it to portal products or map a display name to it.` };
  }

  const categories = form.getAll("category").map(String);
  const hiddenSet = new Set(form.getAll("hidden").map(String));

  await context.db.begin(async (tx: typeof context.db) => {
    for (const category of categories) {
      const displayName = String(form.get(`display_name:${category}`) ?? "").trim();
      const imageUrl = String(form.get(`image_url:${category}`) ?? "").trim();
      const hidden = hiddenSet.has(category);
      await tx`
        INSERT INTO category_settings (category, display_name, hidden, image_url)
        VALUES (${category}, ${displayName}, ${hidden}, ${imageUrl})
        ON CONFLICT (category) DO UPDATE
          SET display_name = EXCLUDED.display_name,
              hidden = EXCLUDED.hidden,
              image_url = EXCLUDED.image_url,
              updated_at = now()
      `;
    }
  });
  return { ok: "Category settings saved." };
}

export default function CategoriesPage() {
  const { categories } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Categories come from 360 with each sync (plus any you add here for portal-only
          products). Rename how they appear on the storefront — same display name merges
          tiles — set a custom tile image, or hide a category from the site. Without a
          custom image, the tile uses the best-stocked product's photo. Click a category
          to see its products.
        </p>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <Alert variant="success">{actionData.ok}</Alert>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <Form method="post" className="flex items-end gap-2">
        <input type="hidden" name="intent" value="add" />
        <div className="flex flex-col gap-1">
          <label htmlFor="new_category" className="text-xs font-medium text-muted-foreground">
            Add a category
          </label>
          <Input id="new_category" name="new_category" placeholder="e.g. Clearance" className="w-64" />
        </div>
        <Button type="submit" variant="outline" disabled={busy}>
          Add
        </Button>
      </Form>

      <Form method="post">
        <input type="hidden" name="intent" value="save" />
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Products (active/total)</TableHead>
                  <TableHead>Display name on storefront</TableHead>
                  <TableHead>Tile image URL</TableHead>
                  <TableHead>Hidden</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No categories yet — run a product sync first.
                    </TableCell>
                  </TableRow>
                )}
                {categories.map((c: CategoryRow) => (
                  <TableRow key={c.category}>
                    <TableCell className="font-medium">
                      <Link
                        to={`/admin/categories/${encodeURIComponent(c.category)}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {c.category}
                      </Link>
                      <input type="hidden" name="category" value={c.category} />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/admin/categories/${encodeURIComponent(c.category)}`}
                        className="text-muted-foreground underline-offset-4 hover:underline"
                      >
                        {c.active_count} / {c.total_count}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Input
                        name={`display_name:${c.category}`}
                        defaultValue={c.display_name}
                        placeholder={c.category}
                        className="h-9 max-w-56"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {c.image_url && (
                          <img
                            src={c.image_url}
                            alt=""
                            className="h-9 w-9 rounded border border-border object-cover"
                          />
                        )}
                        <Input
                          name={`image_url:${c.category}`}
                          defaultValue={c.image_url}
                          placeholder="https://… (blank = auto)"
                          className="h-9 max-w-64"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        name="hidden"
                        value={c.category}
                        defaultChecked={c.hidden}
                        className="size-4 accent-primary"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {categories.length > 0 && (
              <div className="mt-4">
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save category settings"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </Form>
    </div>
  );
}
