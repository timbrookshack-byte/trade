import {
  Form,
  redirect,
  useActionData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { countUsers, createUser, createUserSession } from "~/lib/auth.server";
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
  return [{ title: "Set up — Trade Portal" }];
}

// Only reachable while the users table is empty (first run).
export async function loader({ context }: LoaderFunctionArgs) {
  if ((await countUsers(context)) > 0) throw redirect("/admin/login");
  return null;
}

export async function action({ request, context }: ActionFunctionArgs) {
  if ((await countUsers(context)) > 0) throw redirect("/admin/login");

  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!name || !email.includes("@")) {
    return { error: "Please enter a name and a valid email address." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const user = await createUser(context, { name, email, password, role: "admin" });
  return createUserSession(context, user.id, "/admin");
}

export default function Setup() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to the Trade Portal</CardTitle>
          <CardDescription>
            No users exist yet — create the first admin account for the trade team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="flex flex-col gap-4">
            {actionData?.error && <Alert variant="destructive">{actionData.error}</Alert>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" required autoComplete="name" />
            </div>
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
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create admin account"}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
