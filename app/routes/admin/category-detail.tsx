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
import { formatCurrency } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export function meta({ data }: { data?: { category?: string } }) {
  return [{ title: `${data?.category ?? "Category"} — Trade Portal` }];
}

interface CategoryProduct {
  id: number;
  sku: string;
  name: string;
  source: string;
  image_url: string;
  trade_price: string | null;
  active: boolean;
  available_now: number;
  discontinued_at: string | null;
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const category = params.category ?? "";
  if (!category) throw new Response("Not found", { status: 404 });

  const db = context.db;
  const [settings] = await db<
    { display_name: string; hidden: boolean; image_url: string }[]
  >`
    SELECT COALESCE(display_name, '') AS display_name,
           COALESCE(hidden, FALSE) AS hidden,
           COALESCE(image_url, '') AS image_url
    FROM category_settings WHERE category = ${category}
  `;
  const products = await db<CategoryProduct[]>`
    SELECT id, sku, name, source, image_url, trade_price, active, available_now, discontinued_at
    FROM products WHERE category = ${category}
    ORDER BY (discontinued_at IS NOT NULL), active DESC, name
    LIMIT 1000
  `;
  if (!settings && products.length === 0) throw new Response("Not found", { status: 404 });
  return {
    category,
    settings: settings ?? { display_name: "", hidden: false, image_url: "" },
    products,
  };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireUser(context, request);
  const category = params.category ?? "";
  if (!category) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  await context.db`
    INSERT INTO category_settings (category, display_name, hidden, image_url)
    VALUES (${category},
            ${String(form.get("display_name") ?? "").trim()},
            ${form.get("hidden") === "on"},
            ${String(form.get("image_url") ?? "").trim()})
    ON CONFLICT (category) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          hidden = EXCLUDED.hidden,
          image_url = EXCLUDED.image_url,
          updated_at = now()
  `;
  return { ok: "Category settings saved." };
}

export default function CategoryDetail() {
  const { category, settings, products } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const activeCount = products.filter(
    (p: CategoryProduct) => p.active && !p.discontinued_at,
  ).length;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link to="/admin/categories" className="underline-offset-4 hover:underline">
            Categories
          </Link>{" "}
          / {category}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{category}</h1>
        <p className="text-sm text-muted-foreground">
          {activeCount} active of {products.length} product{products.length === 1 ? "" : "s"}
          {settings.display_name && <> · shows on the storefront as "{settings.display_name}"</>}
          {settings.hidden && <> · hidden from the storefront</>}
        </p>
      </div>

      {actionData?.ok && <Alert variant="success">{actionData.ok}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Storefront settings</CardTitle>
          <CardDescription>
            The raw 360 name never changes — these control how the category appears to
            customers. Same display name as another category merges their tiles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="display_name">Display name on storefront</Label>
              <Input
                id="display_name"
                name="display_name"
                defaultValue={settings.display_name}
                placeholder={category}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="image_url">Tile image URL</Label>
              <div className="flex items-center gap-2">
                {settings.image_url && (
                  <img
                    src={settings.image_url}
                    alt=""
                    className="h-10 w-10 rounded border border-border object-cover"
                  />
                )}
                <Input
                  id="image_url"
                  name="image_url"
                  defaultValue={settings.image_url}
                  placeholder="https://… (blank = best-stocked product's photo)"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="hidden"
                defaultChecked={settings.hidden}
                className="size-4 accent-primary"
              />
              Hide this category from the storefront
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Products in this category</CardTitle>
            <CardDescription>Click a product to edit it.</CardDescription>
          </div>
          <Link
            to={`/admin/products?category=${encodeURIComponent(category)}`}
            className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent"
          >
            Open in Products (bulk actions)
          </Link>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No products in this category yet — assign it on a product's edit page.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Trade price inc GST</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p: CategoryProduct) => (
                  <TableRow key={p.id}>
                    <TableCell className="w-12">
                      <div className="h-10 w-10 overflow-hidden rounded bg-muted">
                        {p.image_url && (
                          <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/admin/products/${p.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="text-right">
                      {p.trade_price != null ? (
                        formatCurrency(Number(p.trade_price))
                      ) : (
                        <span className="text-muted-foreground">no price</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{p.available_now}</TableCell>
                    <TableCell>
                      {p.discontinued_at ? (
                        <Badge variant="outline">discontinued</Badge>
                      ) : p.active ? (
                        <Badge>active</Badge>
                      ) : (
                        <Badge variant="outline">inactive</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
