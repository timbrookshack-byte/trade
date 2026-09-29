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
import type { Customer } from "~/lib/customer-auth.server";
import { BUSINESS_TYPES, businessTypeLabel } from "~/lib/customers";
import { formatCurrency, formatDate, formatDateTime } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input, Select, Textarea } from "~/components/ui/input";
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
  return [{ title: "Edit customer — Trade Portal" }];
}

type CustomerRow = Customer & {
  last_login_at: string | null;
  invited_at: string | null;
  last_order_external: string | null;
  has_password: boolean;
  order_count: number;
  order_total: string | null;
};

async function loadCustomer(context: LoaderFunctionArgs["context"], id: number) {
  const [customer] = await context.db<CustomerRow[]>`
    SELECT c.id, c.business_name, c.abn, c.business_type, c.contact_name, c.email, c.phone,
           c.address, c.price_tier, c.credit_terms, c.approved, c.approved_at, c.active,
           c.created_at, c.last_login_at, c.invited_at, c.last_order_external,
           c.existing_client, c.how_heard, c.website, c.social_media, c.current_projects,
           c.additional_info,
           (c.password_hash <> '') AS has_password,
           (SELECT count(*) FROM orders o
            WHERE o.customer_id = c.id AND o.status NOT IN ('quote', 'cancelled'))::int
             AS order_count,
           (SELECT SUM(o.total_inc_gst) FROM orders o
            WHERE o.customer_id = c.id AND o.status NOT IN ('quote', 'cancelled'))
             AS order_total
    FROM customers c
    WHERE c.id = ${id}
  `;
  return customer ?? null;
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new Response("Not found", { status: 404 });
  const customer = await loadCustomer(context, id);
  if (!customer) throw new Response("Not found", { status: 404 });
  return { customer };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireUser(context, request);
  const id = Number(params.id);
  if (!Number.isInteger(id)) throw new Response("Not found", { status: 404 });
  const form = await request.formData();

  const businessName = String(form.get("business_name") ?? "").trim();
  const contactName = String(form.get("contact_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!businessName) return { error: "Business name is required." };
  if (!contactName) return { error: "Contact name is required." };
  if (!email.includes("@")) return { error: "A valid email is required — it's their login." };

  // Email is the login and is unique — check before the update so the team
  // gets a readable message instead of a constraint error.
  const clash = await context.db`
    SELECT 1 FROM customers WHERE lower(email) = ${email} AND id <> ${id}
  `;
  if (clash.length > 0) {
    return { error: `Another customer already uses ${email}.` };
  }

  const businessTypeRaw = String(form.get("business_type") ?? "");
  const businessType = BUSINESS_TYPES.some((t) => t.value === businessTypeRaw)
    ? businessTypeRaw
    : "other";

  await context.db`
    UPDATE customers SET
      business_name = ${businessName},
      abn = ${String(form.get("abn") ?? "").trim()},
      business_type = ${businessType},
      contact_name = ${contactName},
      email = ${email},
      phone = ${String(form.get("phone") ?? "").trim()},
      address = ${String(form.get("address") ?? "").trim()},
      price_tier = ${String(form.get("price_tier") ?? "").trim() || "standard"},
      credit_terms = ${String(form.get("credit_terms") ?? "").trim()},
      existing_client = ${form.get("existing_client") === "on"},
      updated_at = now()
    WHERE id = ${id}
  `;
  return { ok: "Customer details saved." };
}

export default function CustomerEdit() {
  const { customer } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const application = [
    ["How they heard about us", customer.how_heard],
    ["Website", customer.website],
    ["Social media", customer.social_media],
    ["Current projects", customer.current_projects],
    ["Anything else", customer.additional_info],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link to="/admin/customers" className="underline-offset-4 hover:underline">
            Customers
          </Link>{" "}
          / {customer.business_name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{customer.business_name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {!customer.active ? (
            <Badge variant="destructive">deactivated</Badge>
          ) : customer.approved ? (
            <Badge>approved</Badge>
          ) : (
            <Badge variant="secondary">pending approval</Badge>
          )}
          {customer.existing_client ? (
            <Badge variant="outline">existing client</Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/15 text-amber-800"
            >
              new client
            </Badge>
          )}
          <span>· applied {formatDate(customer.created_at)}</span>
        </div>
      </div>

      {actionData && "ok" in actionData && <Alert variant="success">{actionData.ok}</Alert>}
      {actionData && "error" in actionData && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
          <CardDescription>
            What the customer sees on their invoices and order pages. Approving, deactivating
            and invite links live on the{" "}
            <Link to="/admin/customers" className="underline underline-offset-4">
              customers list
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="business_name">Business name</Label>
              <Input
                id="business_name"
                name="business_name"
                required
                defaultValue={customer.business_name}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact_name">Contact name</Label>
              <Input
                id="contact_name"
                name="contact_name"
                required
                defaultValue={customer.contact_name}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required defaultValue={customer.email} />
              <p className="text-xs text-muted-foreground">
                This is their login — changing it changes how they sign in, so tell them.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" defaultValue={customer.phone} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="abn">ABN</Label>
              <Input id="abn" name="abn" defaultValue={customer.abn} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="business_type">Business type</Label>
              <Select id="business_type" name="business_type" defaultValue={customer.business_type}>
                {BUSINESS_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="price_tier">Price tier</Label>
              <Input id="price_tier" name="price_tier" defaultValue={customer.price_tier} />
              <p className="text-xs text-muted-foreground">
                Recorded for reference — tiered pricing isn't built yet, so every approved
                customer sees the same trade price.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" name="address" rows={3} defaultValue={customer.address} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="credit_terms">Notes / terms</Label>
              <Input
                id="credit_terms"
                name="credit_terms"
                defaultValue={customer.credit_terms}
                placeholder="Internal note — payment in full is required prior to dispatch"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="existing_client"
                  defaultChecked={customer.existing_client}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  Existing client
                  <span className="block text-xs text-muted-foreground">
                    Traded with us before the portal. Existing clients never see the
                    first-order minimum spend notice; new sign-ups do.
                  </span>
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save details"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account activity</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Portal orders</dt>
              <dd className="font-medium">
                {customer.order_count}
                {customer.order_total && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({formatCurrency(Number(customer.order_total))} inc GST)
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Last order (old portal)</dt>
              <dd>
                {customer.last_order_external
                  ? formatDate(customer.last_order_external)
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Last login</dt>
              <dd>{customer.last_login_at ? formatDateTime(customer.last_login_at) : "never"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Password set</dt>
              <dd>{customer.has_password ? "yes" : "not yet"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Launch invite sent</dt>
              <dd>{customer.invited_at ? formatDate(customer.invited_at) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Business type</dt>
              <dd>{businessTypeLabel(customer.business_type)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm">
            <Link
              to={`/admin/orders?filter=all&q=${encodeURIComponent(customer.email)}`}
              className="underline underline-offset-4"
            >
              View their orders
            </Link>
          </p>
        </CardContent>
      </Card>

      {application.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Their application</CardTitle>
            <CardDescription>What they told us when they applied — read only.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              {application.map(([label, value]) => (
                <div key={label}>
                  <dt className="font-medium">{label}</dt>
                  <dd className="whitespace-pre-line text-muted-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
