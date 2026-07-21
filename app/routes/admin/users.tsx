import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { createUser, requireUser, type Role, type User } from "~/lib/auth.server";
import { formatDate } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input, Select } from "~/components/ui/input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export function meta() {
  return [{ title: "Users — Trade Portal" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const me = await requireUser(context, request, { role: "admin" });
  const sql = context.db;
  const users = await sql<User[]>`
    SELECT id, email, name, role, active, created_at
    FROM users
    ORDER BY created_at ASC
  `;
  return { users, myId: me.id };
}

export async function action({ request, context }: ActionFunctionArgs) {
  const me = await requireUser(context, request, { role: "admin" });
  const sql = context.db;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const role = form.get("role") === "admin" ? "admin" : ("staff" satisfies Role);

    if (!name || !email.includes("@")) {
      return { error: "Please enter a name and a valid email address." };
    }
    if (password.length < 8) {
      return { error: "Password must be at least 8 characters." };
    }
    const existing = await sql`SELECT 1 FROM users WHERE lower(email) = lower(${email})`;
    if (existing.length > 0) {
      return { error: "A user with that email already exists." };
    }
    await createUser(context, { name, email, password, role });
    return { ok: `${name} added.` };
  }

  if (intent === "toggle-active") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id)) return { error: "Invalid user." };
    if (id === me.id) return { error: "You can't deactivate your own account." };
    await sql`UPDATE users SET active = NOT active, updated_at = now() WHERE id = ${id}`;
    return { ok: "User updated." };
  }

  return { error: "Unknown action." };
}

export default function UsersPage() {
  const { users, myId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Trade team accounts for this admin panel. Admins can manage users and settings;
          staff can do everything else.
        </p>
      </div>

      {actionData && "ok" in actionData && <Alert variant="success">{actionData.ok}</Alert>}
      {actionData && "error" in actionData && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user: User) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.name}
                    {user.id === myId && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.active ? "outline" : "destructive"}>
                      {user.active ? "active" : "deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(user.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {user.id !== myId && (
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="toggle-active" />
                        <input type="hidden" name="id" value={user.id} />
                        <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                          {user.active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </Form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a user</CardTitle>
          <CardDescription>They can sign in straight away with this password.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="create" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-name">Name</Label>
              <Input id="new-name" name="name" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-email">Email</Label>
              <Input id="new-email" name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-role">Role</Label>
              <Select id="new-role" name="role" defaultValue="staff">
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Add user
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
