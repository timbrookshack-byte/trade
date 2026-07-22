import {
  Form,
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
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const categories = await context.db<CategoryRow[]>`
    SELECT p.category,
           count(*) FILTER (WHERE p.active AND p.discontinued_at IS NULL) AS active_count,
           count(*) AS total_count,
           COALESCE(cs.display_name, '') AS display_name,
           COALESCE(cs.hidden, FALSE) AS hidden
    FROM products p
    LEFT JOIN category_settings cs ON cs.category = p.category
    WHERE p.category <> ''
    GROUP BY p.category, cs.display_name, cs.hidden
    ORDER BY p.category
  `;
  return { categories };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  const categories = form.getAll("category").map(String);
  const hiddenSet = new Set(form.getAll("hidden").map(String));

  await context.db.begin(async (tx: typeof context.db) => {
    for (const category of categories) {
      const displayName = String(form.get(`display_name:${category}`) ?? "").trim();
      const hidden = hiddenSet.has(category);
      await tx`
        INSERT INTO category_settings (category, display_name, hidden)
        VALUES (${category}, ${displayName}, ${hidden})
        ON CONFLICT (category) DO UPDATE
          SET display_name = EXCLUDED.display_name,
              hidden = EXCLUDED.hidden,
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
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Categories come from 360 with each sync. Rename how they appear on the storefront
          (leave blank to keep the 360 name — two categories given the same display name are
          merged into one tile), or hide a category from the site entirely. Admin screens
          always show the original 360 names.
        </p>
      </div>

      {actionData?.ok && <Alert variant="success">{actionData.ok}</Alert>}

      <Form method="post">
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>360 category</TableHead>
                  <TableHead>Products (active/total)</TableHead>
                  <TableHead>Display name on storefront</TableHead>
                  <TableHead>Hidden</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No categories yet — run a product sync first.
                    </TableCell>
                  </TableRow>
                )}
                {categories.map((c: CategoryRow) => (
                  <TableRow key={c.category}>
                    <TableCell className="font-medium">
                      {c.category}
                      <input type="hidden" name="category" value={c.category} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.active_count} / {c.total_count}
                    </TableCell>
                    <TableCell>
                      <Input
                        name={`display_name:${c.category}`}
                        defaultValue={c.display_name}
                        placeholder={c.category}
                        className="h-9 max-w-64"
                      />
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
