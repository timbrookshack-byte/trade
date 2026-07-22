import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getSettings, setSettings } from "~/lib/settings.server";
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
  return [{ title: "Settings — Trade Portal" }];
}

const COMPANY_KEYS = [
  "company_name",
  "company_abn",
  "company_phone",
  "company_email",
  "company_address",
] as const;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request, { role: "admin" });
  const settings = await getSettings(context);
  // API tokens are secrets — never send their values to the browser.
  const { trade_api_token, shopify_admin_token, ...safe } = settings;
  return {
    settings: safe,
    tokenConfigured: Boolean(trade_api_token),
    shopifyTokenConfigured: Boolean(shopify_admin_token),
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request, { role: "admin" });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "company") {
    const entries: Record<string, string> = {};
    for (const key of COMPANY_KEYS) {
      entries[key] = String(form.get(key) ?? "").trim();
    }
    await setSettings(context, entries);
    return { ok: "Company details saved." };
  }

  if (intent === "integration") {
    const discountRaw = Number(String(form.get("trade_discount_percent") ?? "").trim());
    const entries: Record<string, string> = {
      trade_api_url: String(form.get("trade_api_url") ?? "").trim(),
      stock_sync_minutes: String(form.get("stock_sync_minutes") ?? "30").trim(),
      trade_discount_percent:
        Number.isFinite(discountRaw) && discountRaw > 0 && discountRaw < 100
          ? String(discountRaw)
          : "37.5",
    };
    // Blank token field means "keep the existing token".
    const token = String(form.get("trade_api_token") ?? "").trim();
    if (token) entries.trade_api_token = token;
    await setSettings(context, entries);
    return { ok: "Integration settings saved." };
  }

  if (intent === "shopify") {
    const entries: Record<string, string> = {
      shopify_domain: String(form.get("shopify_domain") ?? "")
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, ""),
    };
    // Blank token field means "keep the existing token".
    const token = String(form.get("shopify_admin_token") ?? "").trim();
    if (token) entries.shopify_admin_token = token;
    await setSettings(context, entries);
    return { ok: "Shopify settings saved." };
  }

  return { error: "Unknown action." };
}

export default function SettingsPage() {
  const { settings, tokenConfigured, shopifyTokenConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Company details and the Shack360 integration. All business logic runs in
          Australia/Brisbane time.
        </p>
      </div>

      {actionData && "ok" in actionData && <Alert variant="success">{actionData.ok}</Alert>}
      {actionData && "error" in actionData && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Company details</CardTitle>
          <CardDescription>Used on invoices, emails and the storefront.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="company" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="company_name">Business name</Label>
              <Input
                id="company_name"
                name="company_name"
                defaultValue={settings.company_name ?? ""}
                placeholder="The Furniture Shack — Trade"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="company_abn">ABN</Label>
              <Input
                id="company_abn"
                name="company_abn"
                defaultValue={settings.company_abn ?? ""}
                placeholder="12 345 678 901"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="company_phone">Phone</Label>
              <Input
                id="company_phone"
                name="company_phone"
                defaultValue={settings.company_phone ?? ""}
                placeholder="(07) 3000 0000"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="company_email">Email</Label>
              <Input
                id="company_email"
                name="company_email"
                type="email"
                defaultValue={settings.company_email ?? ""}
                placeholder="trade@thefurnitureshack.com.au"
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="company_address">Address</Label>
              <Textarea
                id="company_address"
                name="company_address"
                defaultValue={settings.company_address ?? ""}
                placeholder="Wakerley QLD"
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save company details
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shack360 integration</CardTitle>
          <CardDescription>
            The product/stock feed from Shack360. The token is stored server-side only and
            is never sent to the browser — leave the field blank to keep the current one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="integration" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="trade_api_url">Trade API URL</Label>
              <Input
                id="trade_api_url"
                name="trade_api_url"
                defaultValue={settings.trade_api_url ?? "https://shack360.app/api/trade/products"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="trade_api_token">
                Trade API token{" "}
                <span className="font-normal text-muted-foreground">
                  {tokenConfigured ? "(configured — blank keeps it)" : "(not configured yet)"}
                </span>
              </Label>
              <Input
                id="trade_api_token"
                name="trade_api_token"
                type="password"
                autoComplete="off"
                placeholder={tokenConfigured ? "••••••••••••" : "Paste the token from 360"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="trade_discount_percent">Default trade discount (% off RRP)</Label>
              <Input
                id="trade_discount_percent"
                name="trade_discount_percent"
                type="number"
                step="0.1"
                min={1}
                max={99}
                className="max-w-32"
                defaultValue={settings.trade_discount_percent ?? "37.5"}
              />
              <p className="text-xs text-muted-foreground">
                Used by "price at default" on the Products page: trade price inc GST = RRP −
                this %, ex GST = inc ÷ 1.1 (e.g. $299 RRP → $186.88 inc / $169.89 ex).
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="stock_sync_minutes">Stock sync interval (minutes)</Label>
              <Input
                id="stock_sync_minutes"
                name="stock_sync_minutes"
                type="number"
                min={5}
                className="max-w-32"
                defaultValue={settings.stock_sync_minutes ?? "30"}
              />
              <p className="text-xs text-muted-foreground">
                The sync cron fires every 15 minutes and runs a sync once this many minutes
                have passed since the last one. "Sync now" on the Products page ignores this.
              </p>
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                Save integration settings
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shopify (lounge bundles)</CardTitle>
          <CardDescription>
            Pulls bundles built with Shopify's native Bundles app — including their component
            SKUs — so packaged deals stay in sync automatically. In Shopify admin: Settings →
            Apps and sales channels → Develop apps → create an app with the{" "}
            <span className="font-mono">read_products</span> scope, install it, and paste the
            Admin API access token here. The token is stored server-side only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="shopify" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="shopify_domain">Shop domain</Label>
              <Input
                id="shopify_domain"
                name="shopify_domain"
                placeholder="your-store.myshopify.com"
                defaultValue={settings.shopify_domain ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="shopify_admin_token">
                Admin API access token{" "}
                <span className="font-normal text-muted-foreground">
                  {shopifyTokenConfigured ? "(configured — blank keeps it)" : "(not configured yet)"}
                </span>
              </Label>
              <Input
                id="shopify_admin_token"
                name="shopify_admin_token"
                type="password"
                autoComplete="off"
                placeholder={shopifyTokenConfigured ? "••••••••••••" : "shpat_…"}
              />
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                Save Shopify settings
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
