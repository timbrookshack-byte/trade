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
import { businessTypeLabel } from "~/lib/customers";
import { cn, formatDate } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Alert } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

export function meta() {
  return [{ title: "Customers — Trade Portal" }];
}

const FILTERS = [
  { key: "pending", label: "Pending approval" },
  { key: "approved", label: "Approved" },
  { key: "all", label: "All" },
] as const;

type Filter = (typeof FILTERS)[number]["key"];

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const url = new URL(request.url);
  const filterParam = url.searchParams.get("filter");
  const filter: Filter = FILTERS.some((f) => f.key === filterParam)
    ? (filterParam as Filter)
    : "pending";
  const customers = await context.db<Customer[]>`
    SELECT id, business_name, abn, business_type, contact_name, email, phone, address,
           price_tier, credit_terms, approved, approved_at, active, created_at
    FROM customers
    WHERE CASE ${filter}
        WHEN 'pending' THEN NOT approved AND active
        WHEN 'approved' THEN approved AND active
        ELSE TRUE
      END
    ORDER BY created_at DESC
  `;
  return { customers, filter };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const db = context.db;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return { error: "Invalid customer." };

  if (intent === "approve") {
    await db`
      UPDATE customers SET approved = TRUE, approved_at = now(), updated_at = now()
      WHERE id = ${id}
    `;
    return { ok: "Customer approved — they can now see trade pricing." };
  }
  if (intent === "revoke") {
    await db`
      UPDATE customers SET approved = FALSE, approved_at = NULL, updated_at = now()
      WHERE id = ${id}
    `;
    return { ok: "Approval revoked — prices are hidden for this customer." };
  }
  if (intent === "toggle-active") {
    await db`UPDATE customers SET active = NOT active, updated_at = now() WHERE id = ${id}`;
    return { ok: "Customer updated." };
  }
  return { error: "Unknown action." };
}

export default function CustomersPage() {
  const { customers, filter } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">
          Trade accounts. New applications need approval before prices are visible —
          check the ABN and business before approving.
        </p>
      </div>

      {actionData && "ok" in actionData && <Alert variant="success">{actionData.ok}</Alert>}
      {actionData && "error" in actionData && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            to={`/admin/customers?filter=${f.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              filter === f.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>ABN</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {filter === "pending"
                      ? "No applications waiting — all caught up."
                      : "No customers here yet."}
                  </TableCell>
                </TableRow>
              )}
              {customers.map((c: Customer) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.business_name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.abn}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {businessTypeLabel(c.business_type)}
                  </TableCell>
                  <TableCell>
                    <p>{c.contact_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.email}
                      {c.phone && <> · {c.phone}</>}
                    </p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(c.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {!c.active ? (
                        <Badge variant="destructive">deactivated</Badge>
                      ) : c.approved ? (
                        <Badge>approved</Badge>
                      ) : (
                        <Badge variant="secondary">pending</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {c.active && !c.approved && (
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="approve" />
                          <input type="hidden" name="id" value={c.id} />
                          <Button type="submit" size="sm" disabled={busy}>
                            Approve
                          </Button>
                        </Form>
                      )}
                      {c.active && c.approved && (
                        <Form method="post" className="inline">
                          <input type="hidden" name="intent" value="revoke" />
                          <input type="hidden" name="id" value={c.id} />
                          <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                            Revoke
                          </Button>
                        </Form>
                      )}
                      <Form method="post" className="inline">
                        <input type="hidden" name="intent" value="toggle-active" />
                        <input type="hidden" name="id" value={c.id} />
                        <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                          {c.active ? "Deactivate" : "Reactivate"}
                        </Button>
                      </Form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
