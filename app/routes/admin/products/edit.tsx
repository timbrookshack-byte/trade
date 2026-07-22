import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { defaultTradePrice, getProduct } from "~/lib/products.server";
import { getSetting } from "~/lib/settings.server";
import { exGst, formatCurrency, formatDate, formatDateTime } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input, Textarea } from "~/components/ui/input";
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

export function meta() {
  return [{ title: "Edit product — Trade Portal" }];
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new Response("Not found", { status: 404 });
  const product = await getProduct(context.db, id);
  if (!product) throw new Response("Not found", { status: 404 });
  const discountPercent =
    Number(await getSetting(context, "trade_discount_percent")) || 37.5;
  const suggested =
    product.rrp_reference != null
      ? defaultTradePrice(Number(product.rrp_reference), discountPercent)
      : null;
  return { product, discountPercent, suggested };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireUser(context, request);
  const db = context.db;
  const id = Number(params.id);
  const product = await getProduct(db, id);
  if (!product) throw new Response("Not found", { status: 404 });

  const form = await request.formData();

  if (form.get("intent") === "apply-default" && product.rrp_reference != null) {
    const discount = Number(await getSetting(context, "trade_discount_percent")) || 37.5;
    const price = defaultTradePrice(Number(product.rrp_reference), discount);
    await db`
      UPDATE products SET trade_price = ${price}, updated_at = now() WHERE id = ${id}
    `;
    return { ok: `Trade price set to the default (RRP − ${discount}%).` };
  }

  const priceRaw = String(form.get("trade_price") ?? "").trim().replace(/[$,\s]/g, "");
  const active = form.get("active") === "on";
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();

  let tradePrice: number | null = null;
  if (priceRaw !== "") {
    tradePrice = Number(priceRaw);
    if (!Number.isFinite(tradePrice) || tradePrice < 0) {
      return { error: "Trade price must be a number (inc GST)." };
    }
  }
  if (!name) return { error: "Name is required." };
  if (active && tradePrice == null) {
    return { error: "Set a trade price before activating — never publish without a price." };
  }

  if (product.source === "shack360") {
    // Copy edits on a 360 product become overrides so the sync stops
    // touching those fields. Unchanged fields keep following 360.
    const overrides = { ...product.overrides };
    if (name !== product.name) overrides.name = true;
    if (description !== product.description) overrides.description = true;
    await db`
      UPDATE products SET
        trade_price = ${tradePrice},
        active = ${active},
        name = ${name},
        description = ${description},
        overrides = ${db.json(overrides)},
        updated_at = now()
      WHERE id = ${id}
    `;
  } else {
    const category = String(form.get("category") ?? "").trim();
    const skuRaw = String(form.get("sku") ?? "").trim().toUpperCase();
    if (!skuRaw) return { error: "SKU is required." };
    const clash = await db`
      SELECT 1 FROM products WHERE upper(sku) = ${skuRaw} AND id <> ${id}
    `;
    if (clash.length > 0) return { error: "That SKU is already used by another product." };
    await db`
      UPDATE products SET
        sku = ${skuRaw},
        trade_price = ${tradePrice},
        active = ${active},
        name = ${name},
        description = ${description},
        category = ${category},
        dimensions = ${String(form.get("dimensions") ?? "").trim()},
        image_url = ${String(form.get("image_url") ?? "").trim()},
        updated_at = now()
      WHERE id = ${id}
    `;
  }
  throw redirect("/admin/products");
}

export default function EditProduct() {
  const { product, discountPercent, suggested } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const is360 = product.source === "shack360";
  const price = product.trade_price != null ? Number(product.trade_price) : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link to="/admin/products" className="underline-offset-4 hover:underline">
              Products
            </Link>{" "}
            / <span className="font-mono">{product.sku}</span>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <div className="mt-1 flex gap-1">
            <Badge variant={is360 ? "secondary" : "outline"}>
              {is360 ? "From Shack360" : "Portal-only"}
            </Badge>
            {product.discontinued_at && (
              <Badge variant="destructive">
                discontinued {formatDate(product.discontinued_at)}
              </Badge>
            )}
          </div>
        </div>
        {product.image_url && (
          <img
            src={product.image_url}
            alt=""
            className="h-24 w-24 rounded-md border border-border object-cover"
          />
        )}
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}
      {actionData && "ok" in actionData && actionData.ok && (
        <Alert variant="success">{actionData.ok}</Alert>
      )}

      {is360 && (
        <Card>
          <CardHeader>
            <CardTitle>Stock (from 360)</CardTitle>
            <CardDescription>
              Wakerley sellable stock, as at{" "}
              {product.stock_synced_at ? formatDateTime(product.stock_synced_at) : "never synced"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-muted-foreground">Available now</p>
              <p className="text-2xl font-semibold">{product.available_now}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Incoming</p>
              {product.incoming.length === 0 ? (
                <p className="text-2xl font-semibold text-muted-foreground">—</p>
              ) : (
                <ul className="mt-1">
                  {product.incoming.map((s, i) => (
                    <li key={i}>
                      <span className="font-medium">{s.qty}</span> — ETA {formatDate(s.eta)}{" "}
                      <span className="text-muted-foreground">({s.status})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">RRP inc GST (reference)</p>
              <p className="text-2xl font-semibold">
                {product.rrp_reference != null
                  ? formatCurrency(Number(product.rrp_reference))
                  : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Trade pricing & visibility</CardTitle>
          <CardDescription>
            Prices are inc GST{price != null && <> (currently {formatCurrency(price)} inc / {formatCurrency(exGst(price))} ex)</>}.
            A product can't be active without a trade price.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {is360 && suggested != null && (
            <Form method="post" className="mb-4">
              <input type="hidden" name="intent" value="apply-default" />
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                Set to default price ({formatCurrency(suggested)} inc GST)
              </Button>
            </Form>
          )}
          <Form method="post" className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="trade_price">Trade price (inc GST)</Label>
                <Input
                  id="trade_price"
                  name="trade_price"
                  inputMode="decimal"
                  defaultValue={product.trade_price ?? ""}
                  placeholder={suggested != null ? String(suggested) : "e.g. 799.00"}
                />
                {suggested != null && (
                  <p className="text-xs text-muted-foreground">
                    Default (RRP − {discountPercent}%): {formatCurrency(suggested)} inc /{" "}
                    {formatCurrency(exGst(suggested))} ex GST
                  </p>
                )}
              </div>
              <div className="flex items-end gap-2 pb-2">
                <input
                  id="active"
                  name="active"
                  type="checkbox"
                  defaultChecked={product.active}
                  className="size-4 accent-primary"
                />
                <Label htmlFor="active">Active (visible to trade customers)</Label>
              </div>
            </div>

            {!is360 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="sku">SKU</Label>
                  <Input id="sku" name="sku" defaultValue={product.sku} required />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" name="category" defaultValue={product.category} />
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="name">
                Name
                {is360 && product.overrides.name && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    (edited locally — no longer follows 360)
                  </span>
                )}
              </Label>
              <Input id="name" name="name" defaultValue={product.name} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">
                Description
                {is360 && product.overrides.description && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    (edited locally — no longer follows 360)
                  </span>
                )}
              </Label>
              <Textarea
                id="description"
                name="description"
                rows={5}
                defaultValue={product.description}
              />
              {is360 && (
                <p className="text-xs text-muted-foreground">
                  Editing the name or description here stops the 360 sync from updating that
                  field on this product.
                </p>
              )}
            </div>

            {!is360 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="dimensions">Dimensions</Label>
                  <Input id="dimensions" name="dimensions" defaultValue={product.dimensions} />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="image_url">Image URL</Label>
                  <Input id="image_url" name="image_url" defaultValue={product.image_url} />
                </div>
              </div>
            )}

            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save product"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
