import {
  Form,
  Link,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { createInviteToken } from "~/lib/customer-auth.server";
import { BUSINESS_TYPES } from "~/lib/customers";
import { customerInviteEmail } from "~/lib/invites.server";
import { queueEmail } from "~/lib/email.server";
import { Button } from "~/components/ui/button";
import { Input, Select, Textarea } from "~/components/ui/input";
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
  return [{ title: "Add customer — Trade Portal" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  const businessName = String(form.get("business_name") ?? "").trim();
  const contactName = String(form.get("contact_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!businessName) return { error: "Business name is required." };
  if (!contactName) return { error: "Contact name is required." };
  if (!email.includes("@")) return { error: "A valid email is required — it's their login." };

  const db = context.db;
  const [clash] = await db<{ id: number; business_name: string }[]>`
    SELECT id, business_name FROM customers WHERE lower(email) = ${email}
  `;
  if (clash) {
    return {
      error: `${clash.business_name} already uses ${email}.`,
      existingId: clash.id,
    };
  }

  const businessTypeRaw = String(form.get("business_type") ?? "");
  const businessType = BUSINESS_TYPES.some((t) => t.value === businessTypeRaw)
    ? businessTypeRaw
    : "other";

  // Added by the team = already vetted, so approved on the spot with no
  // password: they set their own through the invite link.
  const [customer] = await db<{ id: number }[]>`
    INSERT INTO customers (business_name, abn, business_type, contact_name, email, phone,
                           address, password_hash, approved, approved_at, existing_client)
    VALUES (${businessName},
            ${String(form.get("abn") ?? "").trim()},
            ${businessType},
            ${contactName},
            ${email},
            ${String(form.get("phone") ?? "").trim()},
            ${String(form.get("address") ?? "").trim()},
            '', TRUE, now(),
            ${form.get("existing_client") === "on"})
    RETURNING id
  `;

  const invitePath = await createInviteToken(context, customer.id);
  const inviteUrl = `${new URL(request.url).origin}${invitePath}`;
  const emailInvite = form.get("email_invite") === "on";
  if (emailInvite) {
    queueEmail(context, {
      to: [email],
      ...customerInviteEmail(contactName, inviteUrl, new URL(request.url).origin),
    });
    await db`UPDATE customers SET invited_at = now() WHERE id = ${customer.id}`;
  }
  return {
    ok: `${businessName} added and approved.`,
    customerId: customer.id,
    businessName,
    inviteUrl,
    emailed: emailInvite,
  };
}

export default function CustomerNew() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const created = actionData && "ok" in actionData ? actionData : null;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link to="/admin/customers" className="underline-offset-4 hover:underline">
            Customers
          </Link>{" "}
          / add
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Add a customer</h1>
        <p className="text-sm text-muted-foreground">
          For accounts you've set up yourself. They're approved straight away and get an
          invite link to set their own password — no application, no password to invent.
        </p>
      </div>

      {actionData && "error" in actionData && (
        <Alert variant="destructive">
          {actionData.error}{" "}
          {actionData.existingId && (
            <Link
              to={`/admin/customers/${actionData.existingId}`}
              className="font-medium underline underline-offset-4"
            >
              Open that customer
            </Link>
          )}
        </Alert>
      )}

      {created ? (
        <Card>
          <CardHeader>
            <CardTitle>{created.ok}</CardTitle>
            <CardDescription>
              {created.emailed
                ? "Their invite email is on its way (it needs Resend configured to actually send). The same link is below if you'd rather send it yourself."
                : "No email sent — copy the invite link below to them however you like."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite">Invite link (valid 14 days)</Label>
              <Input
                id="invite"
                readOnly
                value={created.inviteUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/admin/customers/${created.customerId}`}
                className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-accent"
              >
                Open {created.businessName}
              </Link>
              <Link
                to="/admin/customers/new"
                reloadDocument
                className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Add another
              </Link>
              <Link
                to="/admin/customers?filter=approved&sort=applied&dir=desc"
                className="inline-flex h-10 items-center px-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Back to customers
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Form method="post" className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="business_name">Business name</Label>
                <Input id="business_name" name="business_name" required autoFocus />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="contact_name">Contact name</Label>
                <Input id="contact_name" name="contact_name" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
                <p className="text-xs text-muted-foreground">
                  Their login, and where the invite goes.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="abn">ABN</Label>
                <Input id="abn" name="abn" />
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="business_type">Business type</Label>
                <Select id="business_type" name="business_type" defaultValue="retailer">
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="address">Address</Label>
                <Textarea id="address" name="address" rows={3} />
              </div>
              <div className="flex flex-col gap-3 sm:col-span-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="email_invite"
                    defaultChecked
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    Email them the invite link now
                    <span className="block text-xs text-muted-foreground">
                      Either way you get the link on the next screen to copy.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="existing_client"
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    Existing client
                    <span className="block text-xs text-muted-foreground">
                      Tick if they've traded with us before — it skips the first-order
                      minimum spend notice.
                    </span>
                  </span>
                </label>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Adding…" : "Add customer & create invite"}
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
