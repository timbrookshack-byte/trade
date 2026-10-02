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
import { createInviteToken } from "~/lib/customer-auth.server";
import { businessTypeLabel, CUSTOMER_FILTERS, customerQueryString } from "~/lib/customers";
import {
  countCustomers,
  CUSTOMERS_PER_PAGE,
  listCustomers,
  parseCustomerQuery,
  type CustomerRow,
} from "~/lib/customers.server";
import { emailTemplates, queueEmail } from "~/lib/email.server";
import {
  customerInviteEmail,
  launchInviteEmail,
  runLaunchInviteDrip,
  requeueUnactivated,
} from "~/lib/invites.server";
import { getSettings, setSettings } from "~/lib/settings.server";
import { cn, formatDate } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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

const FILTERS = CUSTOMER_FILTERS;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const url = new URL(request.url);
  const query = parseCustomerQuery(url);
  const { filter, sort, dir, search } = query;
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page")) || 1));
  const db = context.db;
  const [customers, total] = await Promise.all([
    listCustomers(db, { ...query, page }),
    countCustomers(db, query),
  ]);
  const [inviteStats] = await db<
    { to_invite: number; invited: number; activated: number; sent_today: number }[]
  >`
    SELECT count(*) FILTER (
             WHERE approved AND active AND password_hash = '' AND invited_at IS NULL
           )::int AS to_invite,
           count(*) FILTER (WHERE invited_at IS NOT NULL)::int AS invited,
           count(*) FILTER (WHERE invited_at IS NOT NULL AND password_hash <> '')::int AS activated,
           count(*) FILTER (
             WHERE (invited_at AT TIME ZONE 'Australia/Brisbane')::date
                 = (now() AT TIME ZONE 'Australia/Brisbane')::date
           )::int AS sent_today
    FROM customers
  `;
  const campaignSettings = await getSettings(context, [
    "launch_invites_enabled",
    "launch_invites_daily_cap",
  ]);
  return {
    customers,
    filter,
    sort,
    dir,
    search,
    page,
    total,
    perPage: CUSTOMERS_PER_PAGE,
    inviteCampaign: {
      ...inviteStats,
      enabled: campaignSettings.launch_invites_enabled === "true",
      cap: Number(campaignSettings.launch_invites_daily_cap) || 80,
    },
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const db = context.db;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Launch invite campaign controls (admin-only — they email the customer base).
  if (intent.startsWith("invites-")) {
    const me = await requireUser(context, request, { role: "admin" });
    if (intent === "invites-preview") {
      // The exact launch email, sent to the admin themselves — the real one
      // differs only in the customer's name and a working link.
      const origin = new URL(request.url).origin;
      queueEmail(context, {
        to: [me.email],
        ...launchInviteEmail(me.name, `${origin}/trade/set-password?token=PREVIEW`, origin),
      });
      return {
        ok: `Preview sent to ${me.email} (needs Resend configured). The real one differs only in the customer's name and a working link.`,
      };
    }
    if (intent === "invites-start" || intent === "invites-pause") {
      const cap = Math.max(1, Math.trunc(Number(form.get("cap")) || 80));
      await setSettings(context, {
        launch_invites_enabled: intent === "invites-start" ? "true" : "false",
        launch_invites_daily_cap: String(cap),
      });
      return {
        ok:
          intent === "invites-start"
            ? `Launch invites running — up to ${cap} emails/day go out with the 15-minute cron.`
            : "Launch invites paused. Already-sent links keep working.",
      };
    }
    if (intent === "invites-batch") {
      const result = await runLaunchInviteDrip(context, { force: true });
      if (result.skipped && result.sent === 0) {
        return { error: `No invites sent — ${result.skipped}.` };
      }
      return {
        ok: `${result.sent} invite(s) sent just now (${result.sentToday}/${result.cap} today, ${result.remainingTotal} still to go).`,
      };
    }
    if (intent === "invites-requeue") {
      const count = await requeueUnactivated(context, 7);
      return {
        ok: `${count} customer(s) invited 7+ days ago without setting a password re-queued — the drip will email them again.`,
      };
    }
    return { error: "Unknown action." };
  }

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
  if (intent === "toggle-existing") {
    // Drives the first-order minimum spend: existing clients never see it.
    const [customer] = await db<{ existing_client: boolean; business_name: string }[]>`
      UPDATE customers SET existing_client = NOT existing_client, updated_at = now()
      WHERE id = ${id}
      RETURNING existing_client, business_name
    `;
    if (!customer) return { error: "Customer not found." };
    return {
      ok: customer.existing_client
        ? `${customer.business_name} marked an existing client — no first-order minimum spend notice.`
        : `${customer.business_name} marked a new client — the first-order minimum spend notice applies.`,
    };
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
        ...customerInviteEmail(customer.contact_name, inviteUrl, new URL(request.url).origin),
      });
      await db`UPDATE customers SET invited_at = now() WHERE id = ${id}`;
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
  search,
}: {
  label: string;
  keyName: string;
  filter: string;
  sort: string;
  dir: string;
  search: string;
}) {
  const isActive = sort === keyName;
  const nextDir = isActive && dir === "desc" ? "asc" : "desc";
  return (
    <Link
      to={`/admin/customers?filter=${filter}&sort=${keyName}&dir=${nextDir}${
        search ? `&q=${encodeURIComponent(search)}` : ""
      }`}
      className={cn("underline-offset-4 hover:underline", isActive && "text-foreground")}
    >
      {label}
      {isActive && <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>}
    </Link>
  );
}

export default function CustomersPage() {
  const { customers, filter, sort, dir, search, page, total, perPage, inviteCampaign } =
    useLoaderData<typeof loader>();
  const listQuery = customerQueryString({ filter, sort, dir, search });
  const lastPage = Math.max(1, Math.ceil(total / perPage));
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
        <div className="flex flex-wrap gap-2">
          <a
            href={`/admin/customers/export?${customerQueryString({ filter, sort, dir, search })}`}
            className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-accent"
            title="Downloads exactly the customers listed below"
          >
            Export CSV
          </a>
          <Link
            to="/admin/customers/import"
            className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-accent"
          >
            Import from CSV
          </Link>
          <Link
            to="/admin/customers/new"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add customer
          </Link>
        </div>
      </div>

      {actionData && "ok" in actionData && (
        <Alert variant="success" className="break-all">
          {actionData.ok}
        </Alert>
      )}
      {(inviteCampaign.to_invite > 0 || inviteCampaign.enabled || inviteCampaign.invited > 0) && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-x-6 gap-y-3 pt-6">
            <div className="mr-auto">
              <p className="font-semibold">Launch invites</p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Emails imported customers a personal set-password link, most recent old-portal
                orders first — {inviteCampaign.to_invite} awaiting an invite,{" "}
                {inviteCampaign.invited} sent ({inviteCampaign.activated} have set a password),{" "}
                {inviteCampaign.sent_today}/{inviteCampaign.cap} today.
                {inviteCampaign.enabled
                  ? " Running — batches go out with the 15-minute cron."
                  : " Paused."}
              </p>
            </div>
            <Form method="post" className="flex items-end gap-2">
              <input
                type="hidden"
                name="intent"
                value={inviteCampaign.enabled ? "invites-pause" : "invites-start"}
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="cap" className="text-xs font-medium text-muted-foreground">
                  Max emails/day
                </label>
                <Input
                  id="cap"
                  name="cap"
                  type="number"
                  min={1}
                  defaultValue={inviteCampaign.cap}
                  className="h-9 w-24"
                />
              </div>
              <Button type="submit" disabled={busy}>
                {inviteCampaign.enabled ? "Pause" : "Start sending"}
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="invites-preview" />
              <Button type="submit" variant="outline" disabled={busy}>
                Email me a preview
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="invites-batch" />
              <Button type="submit" variant="outline" disabled={busy}>
                Send a batch now
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="invites-requeue" />
              <Button type="submit" variant="outline" disabled={busy}>
                Re-invite stragglers (7+ days)
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}

      {actionData && "error" in actionData && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            to={`/admin/customers?filter=${f.key}&sort=${sort}&dir=${dir}${
              search ? `&q=${encodeURIComponent(search)}` : ""
            }`}
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
        <Form method="get" className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <Input
            name="q"
            defaultValue={search}
            placeholder="Search business, contact, email, phone, ABN…"
            className="w-72"
          />
          <Button type="submit" variant="secondary" disabled={busy}>
            Search
          </Button>
          {search && (
            <Link
              to={`/admin/customers?filter=${filter}&sort=${sort}&dir=${dir}`}
              className="inline-flex h-10 items-center rounded-md px-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Clear
            </Link>
          )}
        </Form>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortHeader label="Business" keyName="business" filter={filter} sort={sort} dir={dir} search={search} />
                </TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>
                  <SortHeader label="Applied" keyName="applied" filter={filter} sort={sort} dir={dir} search={search} />
                </TableHead>
                <TableHead>
                  <SortHeader label="Last login" keyName="last_login" filter={filter} sort={sort} dir={dir} search={search} />
                </TableHead>
                <TableHead>
                  <SortHeader label="Last order" keyName="last_order" filter={filter} sort={sort} dir={dir} search={search} />
                </TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {search
                      ? `No customers match “${search}”${filter === "all" ? "" : " in this list — try All"}.`
                      : filter === "pending"
                        ? "No applications waiting — all caught up."
                        : "No customers here yet."}
                  </TableCell>
                </TableRow>
              )}
              {customers.map((c: CustomerRow) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium">
                      <Link
                        to={`/admin/customers/${c.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {c.business_name}
                      </Link>
                    </p>
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
                      {c.existing_client ? (
                        <Badge variant="outline" title="No first-order minimum spend notice">
                          existing client
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/15 text-amber-800"
                          title="A first order under the minimum spend gets the soft notice"
                        >
                          new client
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Link
                        to={`/admin/customers/${c.id}`}
                        className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium hover:bg-accent"
                      >
                        Edit
                      </Link>
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
                        <input type="hidden" name="intent" value="toggle-existing" />
                        <input type="hidden" name="id" value={c.id} />
                        <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                          {c.existing_client ? "Mark new" : "Mark existing"}
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
          {total > perPage && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
              </span>
              <span className="flex gap-2">
                {page > 1 && (
                  <Link
                    to={`/admin/customers?${listQuery}&page=${page - 1}`}
                    className="rounded-md border border-input bg-card px-3 py-1.5 font-medium hover:bg-accent"
                  >
                    ← Previous
                  </Link>
                )}
                {page < lastPage && (
                  <Link
                    to={`/admin/customers?${listQuery}&page=${page + 1}`}
                    className="rounded-md border border-input bg-card px-3 py-1.5 font-medium hover:bg-accent"
                  >
                    Next →
                  </Link>
                )}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
