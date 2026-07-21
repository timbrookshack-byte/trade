import postgres from "postgres";

/**
 * postgres.js client for the portal's own database, connected through the
 * Hyperdrive binding. Workers can't share sockets across requests, so a
 * client is created per request in workers/app.ts, exposed to loaders and
 * actions as `context.db`, and closed via ctx.waitUntil after the response.
 * This is the ONLY database the portal talks to — Shack360's DB is off-limits
 * (integration is API-only).
 */
export function createDb(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
    types: {
      // Parse int8 (bigint ids, count(*)) as JS numbers — our ids stay far
      // below 2^53, and string ids break equality checks and session lookups.
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => String(value),
        parse: (value: string) => Number(value),
      },
    },
  });
}

export type Sql = ReturnType<typeof createDb>;
