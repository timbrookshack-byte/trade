import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getSettings } from "~/lib/settings.server";
import { countLowStock, countNewFrom360 } from "~/lib/products.server";
import { getLastSyncRuns } from "~/lib/sync.server";
import { formatDateTime } from "~/lib/utils";
import { Alert } from "~/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function meta() {
  return [{ title: "Dashboard — Trade Portal" }];
}

const LOW_STOCK_THRESHOLD = 5;

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const sql = context.db;
  const [settings, newFrom360, lowStock, syncRuns, activeCountRow, pendingRow, orderStats] =
    await Promise.all([
      getSettings(context, ["company_name", "trade_api_token", "trade_api_url"]),
      countNewFrom360(sql),
      countLowStock(sql, LOW_STOCK_THRESHOLD),
      getLastSyncRuns(sql, 1),
      sql<{ count: number }[]>`
        SELECT count(*) FROM products WHERE active AND discontinued_at IS NULL
      `,
      sql<{ count: number }[]>`
        SELECT count(*) FROM customers WHERE NOT approved AND active
      `,
      sql<{ today: number; open: number }[]>`
        SELECT
          count(*) FILTER (
            WHERE (submitted_at AT TIME ZONE 'Australia/Brisbane')::date =
                  (now() AT TIME ZONE 'Australia/Brisbane')::date
          )::int AS today,
          count(*) FILTER (WHERE status IN ('submitted', 'confirmed', 'picking'))::int AS open
        FROM orders
        WHERE status <> 'quote'
      `,
    ]);
  return {
    companyName: settings.company_name ?? "",
    apiConfigured: Boolean(settings.trade_api_token && settings.trade_api_url),
    newFrom360,
    lowStock,
    activeProducts: activeCountRow[0].count,
    pendingRegistrations: pendingRow[0].count,
    todaysOrders: orderStats[0].today,
    openOrders: orderStats[0].open,
    lastSync: syncRuns[0] ?? null,
  };
}

export default function Dashboard() {
  const {
    companyName,
    apiConfigured,
    newFrom360,
    lowStock,
    activeProducts,
    pendingRegistrations,
    todaysOrders,
    openOrders,
    lastSync,
  } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {companyName || "Trade Portal"}
          {lastSync && (
            <>
              {" "}
              · last 360 sync {formatDateTime(lastSync.started_at)} (
              {lastSync.status === "success" ? `${lastSync.products_in_feed} products` : lastSync.status})
            </>
          )}
        </p>
      </div>

      {!apiConfigured && (
        <Alert>
          The Shack360 Trade API isn't configured yet. Add the feed URL and token in{" "}
          <Link to="/admin/settings" className="font-medium underline underline-offset-4">
            Settings
          </Link>
          , then run a sync from the Products page.
        </Alert>
      )}
      {apiConfigured && !lastSync && (
        <Alert>
          Ready to pull the catalogue —{" "}
          <Link to="/admin/products" className="font-medium underline underline-offset-4">
            run the first 360 sync
          </Link>
          .
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Link to="/admin/orders">
          <Card className="transition-colors hover:bg-accent/50">
            <CardHeader>
              <CardDescription>Today's orders</CardDescription>
              <CardTitle className="text-3xl">{todaysOrders}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {openOrders} open in total.
            </CardContent>
          </Card>
        </Link>
        <Link to="/admin/products?filter=active">
          <Card className="transition-colors hover:bg-accent/50">
            <CardHeader>
              <CardDescription>Active products</CardDescription>
              <CardTitle className="text-3xl">{activeProducts}</CardTitle>
            </CardHeader>
          </Card>
        </Link>
        <Link to="/admin/products?filter=new">
          <Card className="transition-colors hover:bg-accent/50">
            <CardHeader>
              <CardDescription>New from 360 to review</CardDescription>
              <CardTitle className="text-3xl">{newFrom360}</CardTitle>
            </CardHeader>
            {newFrom360 > 0 && (
              <CardContent className="text-xs text-muted-foreground">
                Set a trade price and activate.
              </CardContent>
            )}
          </Card>
        </Link>
        <Card>
          <CardHeader>
            <CardDescription>Low stock (≤{LOW_STOCK_THRESHOLD}, active lines)</CardDescription>
            <CardTitle className="text-3xl">{lowStock}</CardTitle>
          </CardHeader>
        </Card>
        <Link to="/admin/customers?filter=pending">
          <Card className="transition-colors hover:bg-accent/50">
            <CardHeader>
              <CardDescription>Pending registrations</CardDescription>
              <CardTitle className="text-3xl">{pendingRegistrations}</CardTitle>
            </CardHeader>
            {pendingRegistrations > 0 && (
              <CardContent className="text-xs text-muted-foreground">
                Review and approve trade applications.
              </CardContent>
            )}
          </Card>
        </Link>
      </div>
    </div>
  );
}
