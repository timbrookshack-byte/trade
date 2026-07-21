import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { Button } from "~/components/ui/button";
import { Input, Textarea } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Alert } from "~/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta() {
  return [{ title: "Add portal product — Trade Portal" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const db = context.db;
  const form = await request.formData();

  const sku = String(form.get("sku") ?? "").trim().toUpperCase();
  const name = String(form.get("name") ?? "").trim();
  const priceRaw = String(form.get("trade_price") ?? "").trim().replace(/[$,\s]/g, "");
  const active = form.get("active") === "on";

  if (!sku || !name) return { error: "SKU and name are required." };
  let tradePrice: number | null = null;
  if (priceRaw !== "") {
    tradePrice = Number(priceRaw);
    if (!Number.isFinite(tradePrice) || tradePrice < 0) {
      return { error: "Trade price must be a number (inc GST)." };
    }
  }
  if (active && tradePrice == null) {
    return { error: "Set a trade price before activating — never publish without a price." };
  }
  const clash = await db`SELECT 1 FROM products WHERE upper(sku) = ${sku}`;
  if (clash.length > 0) {
    return { error: `SKU ${sku} already exists (it may be a 360 product — check the list).` };
  }

  const [row] = await db<{ id: number }[]>`
    INSERT INTO products (sku, source, name, category, description, dimensions, image_url, trade_price, active)
    VALUES (
      ${sku},
      'portal',
      ${name},
      ${String(form.get("category") ?? "").trim()},
      ${String(form.get("description") ?? "").trim()},
      ${String(form.get("dimensions") ?? "").trim()},
      ${String(form.get("image_url") ?? "").trim()},
      ${tradePrice},
      ${active}
    )
    RETURNING id
  `;
  throw redirect(`/admin/products/${row.id}`);
}

export default function NewProduct() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link to="/admin/products" className="underline-offset-4 hover:underline">
            Products
          </Link>{" "}
          / new
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Add portal-only product</h1>
        <p className="text-sm text-muted-foreground">
          A product the portal masters itself — Shack360 never sees it, and the sync never
          touches it. Don't use a SKU that exists in 360.
        </p>
      </div>

      {actionData?.error && <Alert variant="destructive">{actionData.error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Product details</CardTitle>
          <CardDescription>Prices are inc GST. Stock isn't tracked for portal-only products in phase 1.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" name="sku" required placeholder="e.g. TP-CUSHION-01" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="category">Category</Label>
                <Input id="category" name="category" placeholder="e.g. Accessories" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={4} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="dimensions">Dimensions</Label>
                <Input id="dimensions" name="dimensions" placeholder="e.g. 45 x 45cm" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="image_url">Image URL</Label>
                <Input id="image_url" name="image_url" placeholder="https://…" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="trade_price">Trade price (inc GST)</Label>
                <Input id="trade_price" name="trade_price" inputMode="decimal" placeholder="e.g. 49.00" />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <input id="active" name="active" type="checkbox" className="size-4 accent-primary" />
                <Label htmlFor="active">Active immediately</Label>
              </div>
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create product"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
