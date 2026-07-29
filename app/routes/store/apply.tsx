import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { createCustomerSession, getCustomer, registerCustomer } from "~/lib/customer-auth.server";
import { emailTemplates, getNotifyAddress, queueEmail } from "~/lib/email.server";
import { BUSINESS_TYPES, type BusinessType } from "~/lib/customers";
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
  return [{ title: "Apply for a trade account — The Furniture Shack" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (await getCustomer(context, request)) throw redirect("/products");
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  const businessName = String(form.get("business_name") ?? "").trim();
  const abn = String(form.get("abn") ?? "").trim();
  const businessTypeRaw = String(form.get("business_type") ?? "");
  const contactName = String(form.get("contact_name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const phone = String(form.get("phone") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const businessType = (
    BUSINESS_TYPES.some((t) => t.value === businessTypeRaw) ? businessTypeRaw : "other"
  ) as BusinessType;

  if (!businessName || !contactName || !email.includes("@")) {
    return { error: "Business name, contact name and a valid email are required." };
  }
  const abnDigits = abn.replace(/\s/g, "");
  if (!/^\d{11}$/.test(abnDigits)) {
    return { error: "Please enter a valid 11-digit ABN." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const created = await registerCustomer(context, {
    business_name: businessName,
    abn: abnDigits,
    business_type: businessType,
    contact_name: contactName,
    email,
    phone,
    address,
    password,
    how_heard: String(form.get("how_heard") ?? "").trim(),
    website: String(form.get("website") ?? "").trim(),
    social_media: String(form.get("social_media") ?? "").trim(),
    current_projects: String(form.get("current_projects") ?? "").trim(),
    additional_info: String(form.get("additional_info") ?? "").trim(),
  });
  if (!created) {
    return { error: "An account with that email already exists — try logging in instead." };
  }
  queueEmail(context, { to: [email], ...emailTemplates.registrationReceived(contactName) });
  const notify = await getNotifyAddress(context);
  if (notify) {
    queueEmail(context, {
      to: [notify],
      ...emailTemplates.registrationReceivedTeam(businessName, email),
    });
  }
  return createCustomerSession(context, created.id, "/products?applied=1");
}

export default function Apply() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Apply for a trade account</h1>
        <p className="mt-2 text-muted-foreground">
          Open to Australian businesses in furniture retail, interior design, and commercial
          or hospitality fit-out. Once approved you'll see trade pricing and live
          availability across the whole range, and can order online any time.
        </p>
      </div>

      {actionData?.error && <Alert variant="destructive">{actionData.error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Your business</CardTitle>
          <CardDescription>
            Applications are reviewed against your trading name and ABN — usually within one
            business day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="business_name">Business name</Label>
              <Input id="business_name" name="business_name" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="abn">ABN</Label>
              <Input id="abn" name="abn" required inputMode="numeric" placeholder="11 digits" />
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact_name">Contact name</Label>
              <Input id="contact_name" name="contact_name" required autoComplete="name" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="address">Business address</Label>
              <Textarea id="address" name="address" rows={2} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="website">Website</Label>
              <Input id="website" name="website" placeholder="https://…" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="social_media">Social media</Label>
              <Input
                id="social_media"
                name="social_media"
                placeholder="Instagram / Facebook handle or link"
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="how_heard">How did you hear about us?</Label>
              <Input id="how_heard" name="how_heard" />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="current_projects">
                Are you currently working on any projects?
              </Label>
              <Textarea
                id="current_projects"
                name="current_projects"
                rows={3}
                placeholder="If yes, please provide details including timeline, estimated budget and requirements."
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="additional_info">Additional information</Label>
              <Textarea
                id="additional_info"
                name="additional_info"
                rows={2}
                placeholder="Anything else we should know?"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email (your login)</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-brand text-brand-foreground hover:bg-brand/90 sm:w-auto"
              >
                {busy ? "Submitting…" : "Submit application"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
