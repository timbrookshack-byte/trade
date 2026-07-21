/// <reference types="vite/client" />

// Minimal Workers-runtime types we need. We deliberately avoid pulling in
// @cloudflare/workers-types globally because it conflicts with the DOM lib
// used by the React app code.
interface Hyperdrive {
  readonly connectionString: string;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface Env {
  HYPERDRIVE: Hyperdrive;
  SESSION_SECRET: string;
}

declare module "virtual:react-router/server-build" {
  import type { ServerBuild } from "react-router";
  const build: ServerBuild;
  export = build;
}
