import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { createInviteToken, getCustomer } from "~/lib/customer-auth.server";
import { queueEmail, brandedEmail } from "~/lib/email.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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
  return [{ title: "Reset your password — The Furniture Shack Trade" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (await getCustomer(context, request)) throw redirect("/products");
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  // Honeypot — bots fill every field; humans never see this one.
  if (String(form.get("company_website") ?? "") !== "") return { ok: true };
  const email = String(form.get("email") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter the email you log in with." };

  // Same response whether or not the email exists — never confirm which
  // addresses hold trade accounts.
  const [customer] = await context.db<{ id: number; contact_name: string; email: string }[]>`
    SELECT id, contact_name, email FROM customers
    WHERE lower(email) = lower(${email}) AND active = TRUE
  `;
  if (customer) {
    const path = await createInviteToken(context, customer.id, 1);
    const resetUrl = `${new URL(request.url).origin}${path}`;
    queueEmail(context, {
      to: [customer.email],
      subject: "Reset your trade portal password",
      html: brandedEmail(
        `<p>Hi ${customer.contact_name},</p>
         <p>Someone asked to reset the password for your Furniture Shack trade login.
         Set a new one here (link valid for 24 hours):</p>
         <p><a href="${resetUrl}">${resetUrl}</a></p>
         <p>If this wasn't you, you can ignore this email — your password hasn't
         changed.</p>`,
      ),
    });
  }
  return { ok: true };
}

export default function ForgotPassword() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Enter the email you log in with and we'll send you a link to set a new
            password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actionData && "ok" in actionData && actionData.ok ? (
            <div className="flex flex-col gap-4">
              <Alert variant="success">
                If that email has a trade account, a reset link is on its way — check your
                inbox (and spam folder). The link is valid for 24 hours.
              </Alert>
              <p className="text-sm text-muted-foreground">
                Nothing arrived after a few minutes?{" "}
                <Link to="/contact" className="font-medium underline underline-offset-4">
                  Contact the trade team
                </Link>{" "}
                and we'll sort it out.
              </p>
            </div>
          ) : (
            <Form method="post" className="flex flex-col gap-4">
              {actionData && "error" in actionData && actionData.error && (
                <Alert variant="destructive">{actionData.error}</Alert>
              )}
              <input
                type="text"
                name="company_website"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Sending…" : "Email me a reset link"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Remembered it?{" "}
                <Link to="/trade/login" className="font-medium underline underline-offset-4">
                  Back to login
                </Link>
              </p>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
