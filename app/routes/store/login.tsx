import {
  Form,
  Link,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import {
  createCustomerSession,
  getCustomer,
  verifyCustomerLogin,
} from "~/lib/customer-auth.server";
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
  return [{ title: "Trade login — The Furniture Shack" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if (await getCustomer(context, request)) throw redirect("/products");
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const customer = await verifyCustomerLogin(context, email, password);
  if (!customer) {
    return { error: "Invalid email or password." };
  }
  return createCustomerSession(context, customer.id, "/products");
}

export default function TradeLogin() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Trade login</CardTitle>
          <CardDescription>Sign in to see your trade pricing and availability.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            {actionData?.error && <Alert variant="destructive">{actionData.error}</Alert>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </Form>
          <p className="mt-4 text-sm text-muted-foreground">
            No account yet?{" "}
            <Link to="/trade/apply" className="font-medium underline underline-offset-4">
              Apply for trade access
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
