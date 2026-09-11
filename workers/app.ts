import { createRequestHandler, type AppLoadContext } from "react-router";
import { createDb, type Sql } from "../app/lib/db.server";
import { runScheduledSync } from "../app/lib/sync.server";
import { syncOrders360 } from "../app/lib/three60-orders.server";
import { runLaunchInviteDrip } from "../app/lib/invites.server";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
    db: Sql;
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const db = createDb(env);
    try {
      return await requestHandler(request, {
        cloudflare: { env, ctx },
        db,
      });
    } finally {
      // Let in-flight queries finish, then release the connections.
      ctx.waitUntil(db.end({ timeout: 5 }));
    }
  },

  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext) {
    const db = createDb(env);
    const context: AppLoadContext = { cloudflare: { env, ctx }, db };
    ctx.waitUntil(
      runScheduledSync(db)
        .then((result) => {
          if (result.status !== "skipped") console.log("360 sync:", JSON.stringify(result));
        })
        // Orders push-retry + mirror rides the same cron (no-op until enabled).
        .then(() => syncOrders360(context))
        .then((result) => {
          if (!result.skipped) console.log("360 orders:", JSON.stringify(result));
        })
        // Launch invite drip (no-op unless the campaign is enabled).
        .then(() => runLaunchInviteDrip(context))
        .then((result) => {
          if (!result.skipped) console.log("launch invites:", JSON.stringify(result));
        })
        .finally(() => db.end({ timeout: 5 })),
    );
  },
};
