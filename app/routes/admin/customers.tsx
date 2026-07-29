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
import { createInviteToken, type Customer } from "~/lib/customer-auth.server";
import { businessTypeLabel } from "~/lib/customers";
import { emailTemplates, queueEmail } from "~/lib/email.server";
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

// Whitelisted sort keys → SQL expressions (used via db.unsafe, never user text).
const SORTS: Record<string, string> = {
  business: "lower(c.business_name)",
  applied: "c.created_at",
  last_login: "c.last_login_at",
  last_order: "last_order_at",
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const url = new URL(request.url);
  const filterParam = url.searchParams.get("filter");
  const filter: Filter = FILTERS.some((f) => f.key === filterParam)
    ? (filterParam as Filter)
    : "pending";
  const sort = SORTS[url.searchParams.get("sort") ?? ""] ? url.searchParams.get("sort")! : "applied";
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const db = context.db;
  const customers = await db<(Customer & { last_login_at: string | null; last_order_at: string | null })[]>`
    SELECT c.id, c.business_name, c.abn, c.business_type, c.contact_name, c.email, c.phone,
           c.address, c.price_tier, c.credit_terms, c.approved, c.approved_at, c.active,
           c.created_at, c.last_login_at,
           c.how_heard, c.website, c.social_media, c.current_projects, c.additional_info,
           (SELECT MAX(o.submitted_at) FROM orders o
            WHERE o.customer_id = c.id AND o.status <> 'quote') AS last_order_at
    FROM customers c
    WHERE CASE ${filter}
        WHEN 'pending' THEN NOT c.approved AND c.active
        WHEN 'approved' THEN c.approved AND c.active
        ELSE TRUE
      END
    ORDER BY ${db.unsafe(SORTS[sort])} ${db.unsafe(dir === "asc" ? "ASC" : "DESC")} NULLS LAST
  `;
  return { customers, filter, sort, dir };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const db = context.db;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) return { error: "Invalid customer." };

  if (intent === "approve") {
    const [customer] = await db<{ contact_name: string; email: string }[]>`
      UPDATE customers SET approved = TRUE, approved_at = now(), updated_at = now()
      WHERE id = ${id}
      RETURNING contact_name, email
    `;
    if (customer) {
      queueEmail(context, {
        to: [customer.email],
        ...emailTemplates.registrationApproved(customer.contact_name),
      });
    }
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
  if (intent === "invite") {
    const path = await createInviteToken(context, id);
    const inviteUrl = `${new URL(request.url).origin}${path}`;
    const [customer] = await db<{ contact_name: string; email: string }[]>`
      SELECT contact_name, email FROM customers WHERE id = ${id}
    `;
    if (customer) {
      queueEmail(context, {
        to: [customer.email],
        subject: "Set up your Furniture Shack trade portal login",
        html: `<p>Hi ${customer.contact_name},</p>
          <p>Your trade account is ready on our new trade portal. Set your password here
          (link valid 14 days):</p>
          <p><a href="${inviteUrl}">${inviteUrl}</a></p>`,
      });
    }
    return { ok: `Invite link (emailed if email is configured — valid 14 days): ${inviteUrl}` };
  }
  return { error: "Unknown action." };
}

function SortHeader({
  label,
  keyName,
  filter,
  sort,
  dir,
}: {
  label: string;
  keyName: string;
  filter: string;
  sort: string;
  dir: string;
}) {
  const isActive = sort === keyName;
  const nextDir = isActive && dir === "desc" ? "asc" : "desc";
  return (
    <Link
      to={`/admin/customers?filter=${filter}&sort=${keyName}&dir=${nextDir}`}
      className={cn("underline-offset-4 hover:underline", isActive && "text-foreground")}
    >
      {label}
      {isActive && <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>}
    </Link>
  );
}

export default function CustomersPage() {
  const { customers, filter, sort, dir } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Trade accounts. New applications need approval before prices are visible —
            check the ABN and business before approving.
          </p>
        </div>
        <Link
          to="/admin/customers/import"
          className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-accent"
        >
          Import from CSV
        </Link>
      </div>

      {actionData && "ok" in actionData && (
        <Alert variant="success" className="break-all">
          {actionData.ok}
        </Alert>
      )}
      {actionData && "error" in actionData && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            to={`/admin/customers?filter=${f.key}&sort=${sort}&dir=${dir}`}
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
                <TableHead>
                  <SortHeader label="Business" keyName="business" filter={filter} sort={sort} dir={dir} />
                </TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>
                  <SortHeader label="Applied" keyName="applied" filter={filter} sort={sort} dir={dir} />
                </TableHead>
                <TableHead>
                  <SortHeader label="Last login" keyName="last_login" filter={filter} sort={sort} dir={dir} />
                </TableHead>
                <TableHead>
                  <SortHeader label="Last order" keyName="last_order" filter={filter} sort={sort} dir={dir} />
                </TableHead>
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
              {customers.map((c: Customer & { last_login_at: string | null; last_order_at: string | null }) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium">{c.business_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {c.abn && <>ABN {c.abn} · </>}
                      {businessTypeLabel(c.business_type)}
                    </p>
                    {(c.how_heard || c.website || c.social_media || c.current_projects || c.additional_info || c.address) && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-brand underline-offset-4 hover:underline">
                          Application details
                        </summary>
                        <dl className="mt-2 max-w-md space-y-1.5 text-xs">
                          {c.address && (
                            <div>
                              <dt className="font-medium">Address</dt>
                              <dd className="whitespace-pre-line text-muted-foreground">{c.address}</dd>
                            </div>
                          )}
                          {c.website && (
                            <div>
                              <dt className="font-medium">Website</dt>
                              <dd className="break-all text-muted-foreground">{c.website}</dd>
                            </div>
                          )}
                          {c.social_media && (
                            <div>
                              <dt className="font-medium">Social media</dt>
                              <dd className="break-all text-muted-foreground">{c.social_media}</dd>
                            </div>
                          )}
                          {c.how_heard && (
                            <div>
                              <dt className="font-medium">How they heard about us</dt>
                              <dd className="text-muted-foreground">{c.how_heard}</dd>
                            </div>
                          )}
                          {c.current_projects && (
                            <div>
                              <dt className="font-medium">Current projects</dt>
                              <dd className="whitespace-pre-line text-muted-foreground">{c.current_projects}</dd>
                            </div>
                          )}
                          {c.additional_info && (
                            <div>
                              <dt className="font-medium">Additional information</dt>
                              <dd className="whitespace-pre-line text-muted-foreground">{c.additional_info}</dd>
                            </div>
                          )}
                        </dl>
                      </details>
                    )}
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
                  <TableCell className="text-muted-foreground">
                    {c.last_login_at ? formatDate(c.last_login_at) : "never"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.last_order_at ? formatDate(c.last_order_at) : "—"}
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
                        <input type="hidden" name="intent" value="invite" />
                        <input type="hidden" name="id" value={c.id} />
                        <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                          Invite link
                        </Button>
                      </Form>
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
