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
import {
  consumeInviteToken,
  createCustomerSession,
} from "~/lib/customer-auth.server";
import { hashPassword } from "~/lib/auth.server";
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
  return [{ title: "Set your password — The Furniture Shack Trade" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const valid = token ? await consumeInviteToken(context, token) : null;
  return { token, valid: Boolean(valid) };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const reset = await consumeInviteToken(context, token);
  if (!reset) {
    return { error: "This link has expired or was already used — ask the trade team for a new one." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  const password_hash = await hashPassword(password);
  await context.db`
    UPDATE customers SET password_hash = ${password_hash}, last_login_at = now(), updated_at = now()
    WHERE id = ${reset.customer_id}
  `;
  await context.db`UPDATE password_resets SET used_at = now() WHERE id = ${reset.id}`;
  return createCustomerSession(context, reset.customer_id, "/products");
}

export default function SetPassword() {
  const { token, valid } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Set your password</CardTitle>
          <CardDescription>
            Choose a password for your Furniture Shack trade account — you'll be signed in
            straight away.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!valid ? (
            <Alert variant="destructive">
              This link is invalid, expired, or already used.{" "}
              <Link to="/trade/forgot" className="font-medium underline underline-offset-4">
                Request a fresh reset link
              </Link>{" "}
              or contact the trade team.
            </Alert>
          ) : (
            <Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="token" value={token} />
              {actionData?.error && <Alert variant="destructive">{actionData.error}</Alert>}
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {busy ? "Saving…" : "Set password & sign in"}
              </Button>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
