import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { requireUser } from "~/lib/auth.server";
import { listDiningSets, runDiningSetSync, type DiningSet } from "~/lib/dining.server";
import { formatDateTime } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Alert } from "~/components/ui/alert";
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
  return [{ title: "Dining sets — Trade Portal" }];
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  return { sets: await listDiningSets(context.db) };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireUser(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "sync") {
    const result = await runDiningSetSync(context.db, "manual");
    if (result.status === "error") return { error: `Sync failed: ${result.error}` };
    return {
      ok: `Dining sets synced — ${result.productsInFeed} in Shopify, ${result.created} new, ${result.updated} updated, ${result.discontinued} discontinued.`,
    };
  }

  if (intent === "toggle") {
    const id = Number(form.get("id"));
    if (Number.isInteger(id)) {
      await context.db`
        UPDATE dining_sets SET active = NOT active, updated_at = now() WHERE id = ${id}
      `;
    }
    return { ok: "Saved." };
  }
  return { error: "Unknown action." };
}

export default function AdminDiningSets() {
  const { sets } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dining sets</h1>
          <p className="text-sm text-muted-foreground">
            Configurable table + chairs sets, synced from the Shopify dining set builder.
            Pricing and stock come from the portal catalogue — a set adds its table and
            chairs to the cart as real products.
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="sync" />
          <Button type="submit" disabled={busy}>
            {busy ? "Syncing…" : "Sync dining sets"}
          </Button>
        </Form>
      </div>

      {actionData && "ok" in actionData && actionData.ok && (
        <Alert variant="success">{actionData.ok}</Alert>
      )}
      {actionData && "error" in actionData && actionData.error && (
        <Alert variant="destructive">{actionData.error}</Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Set</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Chair styles</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last synced</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No dining sets yet — connect Shopify (with the metaobjects scopes) and
                    hit "Sync dining sets".
                  </TableCell>
                </TableRow>
              )}
              {sets.map((s: DiningSet & { chair_count: number }) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <a
                      href={`/dining-sets/${encodeURIComponent(s.slug)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {s.title}
                    </a>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.table_product_title}
                  </TableCell>
                  <TableCell>{s.chair_count}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.qty_options.join(" / ")}
                  </TableCell>
                  <TableCell>
                    {s.discontinued_at ? (
                      <Badge variant="destructive">gone from Shopify</Badge>
                    ) : s.active ? (
                      <Badge>live</Badge>
                    ) : (
                      <Badge variant="secondary">hidden</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.synced_at ? formatDateTime(s.synced_at) : "—"}
                  </TableCell>
                  <TableCell>
                    <Form method="post">
                      <input type="hidden" name="intent" value="toggle" />
                      <input type="hidden" name="id" value={s.id} />
                      <Button type="submit" variant="outline" size="sm" disabled={busy}>
                        {s.active ? "Hide" : "Show"}
                      </Button>
                    </Form>
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
