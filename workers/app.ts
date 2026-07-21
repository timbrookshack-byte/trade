import { createRequestHandler } from "react-router";
import { createDb, type Sql } from "../app/lib/db.server";
import { runScheduledSync } from "../app/lib/sync.server";

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
    ctx.waitUntil(
      runScheduledSync(db)
        .then((result) => {
          if (result.status !== "skipped") console.log("360 sync:", JSON.stringify(result));
        })
        .finally(() => db.end({ timeout: 5 })),
    );
  },
};
