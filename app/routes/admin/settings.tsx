import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { sendTestEmail } from "~/lib/email.server";
import { generatePartnerKey, sha256Hex } from "~/lib/partner.server";
import { getSettings, setSettings } from "~/lib/settings.server";
import { MINIMUM_SPEND_DEFAULT } from "~/lib/minimum-spend";
import { formatCurrency, formatDate } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
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
  "company_instagram",
  "company_hours",
] as const;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request, { role: "admin" });
  const settings = await getSettings(context);
  // API tokens/secrets are never sent to the browser.
  const {
    trade_api_token,
    shopify_admin_token,
    shopify_client_secret,
    shopify_oauth_state: _state,
    resend_api_key,
    ...safe
  } = settings;
  const partnerKeys = await context.db<
    {
      id: number;
      label: string;
      include_trade_prices: boolean;
      active: boolean;
      created_at: string;
      last_used_at: string | null;
    }[]
  >`
    SELECT id, label, include_trade_prices, active,
           created_at::text AS created_at, last_used_at::text AS last_used_at
    FROM partner_api_keys ORDER BY created_at DESC
  `;
  return {
    settings: safe,
    partnerKeys,
    tokenConfigured: Boolean(trade_api_token),
    shopifyConnected: Boolean(shopify_admin_token),
    shopifySecretConfigured: Boolean(shopify_client_secret),
    resendConfigured: Boolean(resend_api_key),
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

  if (intent === "storefront") {
    await setSettings(context, {
      product_image_fit: form.get("product_image_fit") === "cover" ? "cover" : "contain",
    });
    return { ok: "Storefront display settings saved." };
  }

  if (intent === "ordering") {
    const raw = String(form.get("minimum_order_amount") ?? "").trim().replace(/[$,]/g, "");
    const amount = Number(raw);
    await setSettings(context, {
      minimum_order_amount:
        raw !== "" && Number.isFinite(amount) && amount >= 0
          ? String(amount)
          : String(MINIMUM_SPEND_DEFAULT),
    });
    return { ok: "Trade ordering settings saved." };
  }

  if (intent === "branding") {
    const overlayRaw = Number(String(form.get("hero_overlay") ?? "").trim());
    await setSettings(context, {
      site_logo_url: String(form.get("site_logo_url") ?? "").trim(),
      favicon_url: String(form.get("favicon_url") ?? "").trim(),
      hero_image_url: String(form.get("hero_image_url") ?? "").trim(),
      hero_overlay:
        Number.isFinite(overlayRaw) && overlayRaw >= 0 && overlayRaw <= 85
          ? String(Math.round(overlayRaw))
          : "45",
      hero_heading: String(form.get("hero_heading") ?? "").trim(),
      hero_subheading: String(form.get("hero_subheading") ?? "").trim(),
      hero_points: String(form.get("hero_points") ?? "").trim(),
    });
    return { ok: "Branding & hero saved." };
  }

  if (intent === "payment") {
    const entries: Record<string, string> = {};
    for (const key of [
      "payment_phone",
      "payment_account_name",
      "payment_bsb",
      "payment_account_number",
      "payment_remittance_email",
    ]) {
      entries[key] = String(form.get(key) ?? "").trim();
    }
    await setSettings(context, entries);
    return { ok: "Payment details saved." };
  }

  if (intent === "integration") {
    const discountRaw = Number(String(form.get("trade_discount_percent") ?? "").trim());
    const entries: Record<string, string> = {
      trade_api_url: String(form.get("trade_api_url") ?? "").trim(),
      orders_360_enabled: form.get("orders_360_enabled") === "on" ? "true" : "false",
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
      shopify_client_id: String(form.get("shopify_client_id") ?? "").trim(),
    };
    // Blank secret field means "keep the existing one".
    const secret = String(form.get("shopify_client_secret") ?? "").trim();
    if (secret) entries.shopify_client_secret = secret;
    await setSettings(context, entries);
    return { ok: "Shopify settings saved — now click Connect to Shopify." };
  }

  if (intent === "partner-create") {
    const label = String(form.get("label") ?? "").trim();
    if (!label) return { error: "Give the key a label (who it's for)." };
    const key = generatePartnerKey();
    await context.db`
      INSERT INTO partner_api_keys (label, key_hash, include_trade_prices)
      VALUES (${label}, ${await sha256Hex(key)}, ${form.get("include_trade_prices") === "on"})
    `;
    return {
      ok:
        `Partner key created for "${label}" — copy it NOW, it can't be shown again: ${key}  ` +
        `They call: GET ${new URL(request.url).origin}/api/partner/products with header ` +
        `"Authorization: Bearer <key>".`,
    };
  }
  if (intent === "partner-toggle") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id)) return { error: "Invalid key." };
    const [row] = await context.db<{ active: boolean; label: string }[]>`
      UPDATE partner_api_keys SET active = NOT active WHERE id = ${id}
      RETURNING active, label
    `;
    if (!row) return { error: "Invalid key." };
    return {
      ok: row.active
        ? `Key "${row.label}" re-enabled.`
        : `Key "${row.label}" revoked — their requests now get 401 immediately.`,
    };
  }

  if (intent === "test-email") {
    const me = await requireUser(context, request, { role: "admin" });
    const result = await sendTestEmail(context, me.email);
    return result.ok
      ? { ok: `Test email sent to ${me.email}. ${result.detail}` }
      : { error: `Test email failed. ${result.detail}` };
  }

  if (intent === "emails") {
    const entries: Record<string, string> = {
      email_from: String(form.get("email_from") ?? "").trim(),
      email_notify: String(form.get("email_notify") ?? "").trim(),
    };
    const key = String(form.get("resend_api_key") ?? "").trim();
    if (key) entries.resend_api_key = key;
    await setSettings(context, entries);
    return { ok: "Email settings saved." };
  }

  return { error: "Unknown action." };
}

export default function SettingsPage() {
  const { settings, partnerKeys, tokenConfigured, shopifyConnected, shopifySecretConfigured, resendConfigured } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const busy = navigation.state !== "idle";
  const shopifyJustConnected = searchParams.get("shopify") === "connected";
  const shopifyError = searchParams.get("shopify_error");

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
      {shopifyJustConnected && (
        <Alert variant="success">
          Connected to Shopify — run "Sync bundles" on the Products page to pull your packages.
        </Alert>
      )}
      {shopifyError && <Alert variant="destructive">Shopify connection: {shopifyError}</Alert>}

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
            <div className="flex flex-col gap-2">
              <Label htmlFor="company_instagram">Instagram</Label>
              <Input
                id="company_instagram"
                name="company_instagram"
                defaultValue={settings.company_instagram ?? ""}
                placeholder="@thefurnitureshack"
              />
              <p className="text-xs text-muted-foreground">
                Handle or full URL — shown on the contact page and in the footer.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="company_hours">Opening hours</Label>
              <Textarea
                id="company_hours"
                name="company_hours"
                rows={3}
                defaultValue={settings.company_hours ?? ""}
                placeholder={"Mon–Fri 8:30am–4:30pm\nSat by appointment"}
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
          <CardTitle>Branding & home hero</CardTitle>
          <CardDescription>
            Logo and favicon show across the whole site; the hero image sits at the top of
            the home page with your message over it. Host images anywhere (e.g. Shopify
            files) and paste the URLs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="branding" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="site_logo_url">Logo image URL</Label>
              <div className="flex items-center gap-2">
                {settings.site_logo_url && (
                  <img src={settings.site_logo_url} alt="" className="h-9 w-auto rounded border border-border bg-white p-0.5" />
                )}
                <Input
                  id="site_logo_url"
                  name="site_logo_url"
                  placeholder="https://… (blank = text logo)"
                  defaultValue={settings.site_logo_url ?? ""}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Displays ~40px tall in the header — a wide transparent PNG/SVG works best.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="favicon_url">Favicon URL</Label>
              <div className="flex items-center gap-2">
                {settings.favicon_url && (
                  <img src={settings.favicon_url} alt="" className="h-8 w-8 rounded border border-border" />
                )}
                <Input
                  id="favicon_url"
                  name="favicon_url"
                  placeholder="https://… (.png or .ico, square)"
                  defaultValue={settings.favicon_url ?? ""}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The little browser-tab icon — 64×64px or larger square image.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="hero_image_url">Home hero image URL</Label>
              <Input
                id="hero_image_url"
                name="hero_image_url"
                placeholder="https://… (wide lifestyle photo; blank = plain text hero)"
                defaultValue={settings.hero_image_url ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hero_overlay">Image darkness ({settings.hero_overlay ?? "45"}%)</Label>
              <input
                id="hero_overlay"
                name="hero_overlay"
                type="range"
                min={0}
                max={85}
                step={5}
                defaultValue={settings.hero_overlay ?? "45"}
                className="accent-brand"
              />
              <p className="text-xs text-muted-foreground">
                Darkens the photo so the white text stays readable — nudge up for bright
                images, down for moody ones.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hero_heading">Hero heading</Label>
              <Input
                id="hero_heading"
                name="hero_heading"
                placeholder="The Furniture Shack range, at trade prices."
                defaultValue={settings.hero_heading ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="hero_subheading">Hero subheading</Label>
              <Textarea
                id="hero_subheading"
                name="hero_subheading"
                rows={2}
                placeholder="For retailers, interior designers and commercial projects…"
                defaultValue={settings.hero_subheading ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="hero_points">Key points (one per line, up to 4)</Label>
              <Textarea
                id="hero_points"
                name="hero_points"
                rows={3}
                placeholder={"Trade pricing on the full range\nLive Brisbane stock + ETAs\nInvoiced ordering, 24/7"}
                defaultValue={settings.hero_points ?? ""}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save branding & hero
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storefront display</CardTitle>
          <CardDescription>
            How product photos sit in their frames across the whole store — gallery cards,
            product pages, carts and product sheets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="storefront" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="product_image_fit">Product image layout</Label>
              <select
                id="product_image_fit"
                name="product_image_fit"
                defaultValue={settings.product_image_fit === "cover" ? "cover" : "contain"}
                className="h-10 max-w-md rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="contain">
                  Fit the whole item (no cropping — how Shopify themes do it)
                </option>
                <option value="cover">Zoom to fill the frame (crops tall/wide photos)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Fit shows the entire piece on a white background whatever its shape (2:1
                sideboards, 1:2 lamps). Category tiles have their own per-category setting
                on the Categories pages.
              </p>
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                Save storefront display
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trade ordering</CardTitle>
          <CardDescription>
            The minimum spend we ask of a new trade customer on their first order. It never
            blocks an order — under-threshold carts get a quiet note at confirmation saying
            we'll be in touch, and the order is flagged for the team here in admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="ordering" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="minimum_order_amount">
                Minimum first-order spend (ex GST)
              </Label>
              <Input
                id="minimum_order_amount"
                name="minimum_order_amount"
                inputMode="decimal"
                className="max-w-[12rem]"
                placeholder={String(MINIMUM_SPEND_DEFAULT)}
                defaultValue={settings.minimum_order_amount ?? String(MINIMUM_SPEND_DEFAULT)}
              />
              <p className="text-xs text-muted-foreground">
                Dollars ex GST — {formatCurrency(MINIMUM_SPEND_DEFAULT)} by default. Set it to
                0 to turn the notice off entirely. Repeat customers are never shown it.
              </p>
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                Save trade ordering
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment details</CardTitle>
          <CardDescription>
            Shown on tax invoices, customer order pages, the FAQ page and order emails —
            payment in full is required prior to dispatch. Blank fields fall back to the
            defaults shown as placeholders.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="payment" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="payment_phone">Credit card payment phone</Label>
              <Input
                id="payment_phone"
                name="payment_phone"
                placeholder="0424 477 794"
                defaultValue={settings.payment_phone ?? ""}
              />
              <p className="text-xs text-muted-foreground">
                Invoices say: call this number to pay via Visa/Mastercard (no fee) or AMEX
                (1.95% surcharge).
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="payment_account_name">Bank account name</Label>
              <Input
                id="payment_account_name"
                name="payment_account_name"
                placeholder="The Furniture Shack Pty Ltd (NAB)"
                defaultValue={settings.payment_account_name ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="payment_bsb">BSB</Label>
              <Input
                id="payment_bsb"
                name="payment_bsb"
                placeholder="084 129"
                defaultValue={settings.payment_bsb ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="payment_account_number">Account number</Label>
              <Input
                id="payment_account_number"
                name="payment_account_number"
                placeholder="57 165 0656"
                defaultValue={settings.payment_account_number ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="payment_remittance_email">Remittance advice email</Label>
              <Input
                id="payment_remittance_email"
                name="payment_remittance_email"
                type="email"
                placeholder="trade@thefurnitureshack.com.au"
                defaultValue={settings.payment_remittance_email ?? ""}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save payment details
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
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name="orders_360_enabled"
                  defaultChecked={settings.orders_360_enabled === "true"}
                  className="size-4 accent-primary"
                />
                Push orders to 360 (phase 2)
              </label>
              <p className="text-xs text-muted-foreground">
                When on, submitted orders land in 360 as unconfirmed quotes; the team edits
                and confirms them in 360 and the portal mirrors the result back (lines,
                freight, status). Leave off until 360's orders API is live — orders then
                behave exactly as today.
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
          <CardTitle>
            Shopify (lounge bundles)
            {shopifyConnected && (
              <span className="ml-2 rounded-full bg-green-600/10 px-2.5 py-0.5 text-xs font-medium text-green-800">
                connected
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Pulls bundles built with Shopify's native Bundles app — including their component
            SKUs — so packaged deals stay in sync automatically. Create an app in the Shopify
            Dev Dashboard with the <span className="font-mono">read_products</span> scope and
            redirect URL <span className="font-mono">https://thefurnitureshack.trade/admin/shopify/callback</span>,
            paste its Client ID and Client secret here, save, then click Connect. Secrets are
            stored server-side only.
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="shopify_client_id">Client ID</Label>
                <Input
                  id="shopify_client_id"
                  name="shopify_client_id"
                  autoComplete="off"
                  defaultValue={settings.shopify_client_id ?? ""}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="shopify_client_secret">
                  Client secret{" "}
                  <span className="font-normal text-muted-foreground">
                    {shopifySecretConfigured ? "(saved — blank keeps it)" : "(shpss_…)"}
                  </span>
                </Label>
                <Input
                  id="shopify_client_secret"
                  name="shopify_client_secret"
                  type="password"
                  autoComplete="off"
                  placeholder={shopifySecretConfigured ? "••••••••••••" : "shpss_…"}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={busy}>
                Save Shopify settings
              </Button>
              <a
                href="/admin/shopify/connect"
                className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand/90"
              >
                {shopifyConnected ? "Reconnect to Shopify" : "Connect to Shopify"}
              </a>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emails (Resend)</CardTitle>
          <CardDescription>
            Order and registration emails are sent through Resend from a domain-verified
            sender. Without an API key, everything still works — no emails go out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="emails" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="resend_api_key">
                Resend API key{" "}
                <span className="font-normal text-muted-foreground">
                  {resendConfigured ? "(configured — blank keeps it)" : "(not configured yet)"}
                </span>
              </Label>
              <Input
                id="resend_api_key"
                name="resend_api_key"
                type="password"
                autoComplete="off"
                placeholder={resendConfigured ? "••••••••••••" : "re_…"}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email_from">From address (verified in Resend)</Label>
                <Input
                  id="email_from"
                  name="email_from"
                  placeholder="The Furniture Shack Commercial <trade@thefurnitureshack.com.au>"
                  defaultValue={settings.email_from ?? ""}
                />
                <p className="text-xs text-muted-foreground">
                  Use the "Name &lt;address&gt;" format to control the sender name customers
                  see — a bare address shows just "trade". The address's domain must be
                  verified in Resend.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email_notify">Trade team inbox (new orders/applications)</Label>
                <Input
                  id="email_notify"
                  name="email_notify"
                  placeholder="trade@thefurnitureshack.com.au"
                  defaultValue={settings.email_notify ?? ""}
                />
              </div>
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                Save email settings
              </Button>
            </div>
          </Form>
          <Form method="post" className="mt-4 border-t border-border pt-4">
            <input type="hidden" name="intent" value="test-email" />
            <Button type="submit" variant="outline" disabled={busy}>
              Send a test email to me
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Sends to your admin login address and shows Resend's actual response up top —
              including the exact error if the key is wrong or the from-domain isn't verified.
            </p>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Partner product feed</CardTitle>
          <CardDescription>
            Read-only catalogue API for partners who list our range on their own sites
            (GET /api/partner/products, Bearer key). It only ever exposes what the public
            storefront could show — plus RRP and a stock band, never warehouse numbers —
            and trade prices only when a key explicitly includes them. Keys are shown once
            on creation and stored hashed; revoking cuts access instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {partnerKeys.length > 0 && (
            <div className="flex flex-col divide-y divide-border rounded-md border border-border">
              {partnerKeys.map((k: (typeof partnerKeys)[number]) => (
                <div key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  <span className="font-medium">{k.label}</span>
                  {k.include_trade_prices && <Badge variant="outline">trade prices</Badge>}
                  {!k.active && <Badge variant="destructive">revoked</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {k.last_used_at
                      ? `last used ${formatDate(k.last_used_at)}`
                      : "never used"}
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="partner-toggle" />
                    <input type="hidden" name="id" value={k.id} />
                    <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                      {k.active ? "Revoke" : "Re-enable"}
                    </Button>
                  </Form>
                </div>
              ))}
            </div>
          )}
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="partner-create" />
            <div className="flex flex-col gap-1">
              <Label htmlFor="partner-label" className="text-xs text-muted-foreground">
                New key label (who it's for)
              </Label>
              <Input id="partner-label" name="label" placeholder="e.g. Coastal Interiors website" className="h-9 w-64" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="include_trade_prices" className="size-4 accent-primary" />
              include trade prices (rarely — their site is public)
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              Create key
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
