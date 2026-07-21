# Trade Portal

Standalone trade website + admin panel for The Furniture Shack's trade
department. Replaces Shopify for trade customers. Pulls the product catalogue
and live stock from Shack360's Trade API (API-only — never 360's database).

**Read `CLAUDE.md` first** — it's the founding brief: integration contract,
golden rules, data model, and milestone plan.

## Stack

React Router 7 (framework mode, SSR) on Cloudflare Workers · PostgreSQL via
Hyperdrive (postgres.js) · Tailwind CSS v4 + shadcn-style components · wrangler.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars          # set SESSION_SECRET

# Point local dev + migrations at a local Postgres:
createdb trade_portal                   # or however you provision it
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trade_portal npm run db:migrate

npm run dev                             # http://localhost:5173
```

The dev server runs in workerd via the Cloudflare Vite plugin; the database
connection comes from the Hyperdrive `localConnectionString` in `wrangler.jsonc`
(override with `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`).

First visit: `/admin` redirects to `/admin/setup` to create the first admin
account (only while no users exist).

## Deploy

```sh
wrangler hyperdrive create trade-portal-db --connection-string="postgresql://…"
# put the returned id into wrangler.jsonc → hyperdrive[0].id
wrangler secret put SESSION_SECRET
DATABASE_URL=… npm run db:migrate       # run migrations against the prod DB
npm run deploy
```

## Commands

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Local dev server (workerd)                      |
| `npm run build`     | Production build                                |
| `npm run deploy`    | Build + `wrangler deploy`                       |
| `npm run typecheck` | React Router typegen + `tsc`                    |
| `npm run db:migrate`| Apply `migrations/*.sql` (needs `DATABASE_URL`) |
