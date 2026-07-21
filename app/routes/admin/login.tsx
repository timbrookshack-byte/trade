import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { countUsers, createUserSession, getUser, verifyLogin } from "~/lib/auth.server";
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
  return [{ title: "Sign in — Trade Portal" }];
}

/** Only allow same-origin relative redirect targets. */
function safeRedirect(value: FormDataEntryValue | string | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/admin";
  }
  return value;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  if ((await countUsers(context)) === 0) throw redirect("/admin/setup");
  if (await getUser(context, request)) throw redirect("/admin");
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const redirectTo = safeRedirect(form.get("redirectTo"));

  const user = await verifyLogin(context, email, password);
  if (!user) {
    return { error: "Invalid email or password." };
  }
  return createUserSession(context, user.id, redirectTo);
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const busy = navigation.state !== "idle";

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Trade Portal admin</CardTitle>
          <CardDescription>Sign in with your trade team account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            <input
              type="hidden"
              name="redirectTo"
              value={searchParams.get("redirectTo") ?? "/admin"}
            />
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
        </CardContent>
      </Card>
    </main>
  );
}
