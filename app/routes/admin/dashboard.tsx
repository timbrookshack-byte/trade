import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { getSettings } from "~/lib/settings.server";
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

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUser(context, request);
  const sql = context.db;
  const [userCount] = await sql<{ count: string }[]>`SELECT count(*) FROM users WHERE active`;
  const settings = await getSettings(context, ["company_name", "trade_api_token", "trade_api_url"]);
  return {
    activeUsers: Number(userCount.count),
    companyName: settings.company_name ?? "",
    apiConfigured: Boolean(settings.trade_api_token && settings.trade_api_url),
  };
}

export default function Dashboard() {
  const { activeUsers, companyName, apiConfigured } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {companyName || "Trade Portal"} — milestone 1 (scaffold, auth, settings)
        </p>
      </div>

      {!apiConfigured && (
        <Alert>
          The Shack360 Trade API isn't configured yet. Add the feed URL and token in{" "}
          <Link to="/admin/settings" className="font-medium underline underline-offset-4">
            Settings
          </Link>{" "}
          — the product sync (milestone 2) needs them.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Active admin users</CardDescription>
            <CardTitle className="text-3xl">{activeUsers}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Today's orders</CardDescription>
            <CardTitle className="text-3xl text-muted-foreground">—</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Arrives with milestone 4 (orders).
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Pending registrations</CardDescription>
            <CardTitle className="text-3xl text-muted-foreground">—</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Arrives with milestone 3 (trade customers).
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
