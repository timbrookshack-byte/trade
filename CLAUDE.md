# Trade Portal — CLAUDE.md (founding brief + project conventions)

This is the standalone **trade portal** for The Furniture Shack's trade
department. It replaces Shopify for trade customers. Every session working in
this repo must follow this document.

## What this is

- **Public/trade-facing site**: showcases products with trade pricing; trade
  customers log in, browse, and place orders.
- **Admin panel**: the trade team manages products, stock, customers, orders and
  payments — a compact POS. Think "Shack360 lite", but its own system.
- **Shack360 is the base catalogue and the stock truth** for shared products:
  the portal pulls all Furniture Shack products + live availability from 360's
  Trade API. The portal can ALSO create its own portal-only products that 360
  never sees.

## Stack

- **React Router 7 (framework mode, SSR) on Cloudflare Workers** — same as 360.
- **PostgreSQL via Hyperdrive** (own database — NEVER connect to 360's DB;
  integration is API-only). Driver: `postgres` (postgres.js) with
  `nodejs_compat`.
- Tailwind CSS v4 + shadcn-style components (hand-rolled in
  `app/components/ui/`, same conventions as 360). Corporate palette: strong
  black primary + fuchsia accent (`--color-brand` in `app/app.css`) — brand
  is for key CTAs (Apply, submit application), black for everything else.
- Deploy with wrangler; one production environment to start.

## The golden rules

1. **360's database is off-limits.** All integration through the HTTP API below.
   The portal has its own Postgres for everything it owns.
2. **For shared (360-sourced) products, 360 owns identity and stock.** The
   portal caches, it never masters. Portal-only products are mastered locally.
3. **SKU is the join key** between the two systems. Never invent SKUs for
   360-sourced products; never edit their SKUs locally.
4. **Trade prices live in the portal**, not 360. 360 supplies RRP inc GST as a
   reference; the trade price book (per-product, optionally per-customer-tier)
   is portal data. **Default pricing formula**: trade price inc GST =
   RRP − `trade_discount_percent` (settings, default 37.5%); ex GST is
   derived (÷ 1.1). E.g. $299 RRP → $186.88 inc / $169.89 ex. Bulk "price at
   default" + "activate priced" actions live on the admin products page.
5. **Stock shown to trade customers = cached 360 availability**, clearly
   timestamped ("stock as at 7:05am"). Do not promise real-time.

## Integration contract (LIVE on 360 today)

### GET `https://shack360.app/api/trade/products?token=<TRADE_API_TOKEN>`

Also accepts `Authorization: Bearer <token>`. Returns:

```json
{
  "generated_at": "2026-07-21T21:00:00.000Z",
  "count": 412,
  "products": [
    {
      "sku": "SDS23991UDCT",
      "name": "Aveiro Hybrid Adjustable Coffee Table in Taupe with Polywood Inset",
      "category": "Coffee Tables",
      "description": "…",
      "rrp_inc_gst": 1199,
      "dimensions": "120 x 70 x 45cm",
      "cbm": 0.6532,
      "weight_kg": 38,
      "image_url": "https://…",
      "store_link": "https://…",
      "available_now": 59,
      "incoming": [ { "qty": 86, "eta": "2026-08-14", "status": "confirmed" } ]
    }
  ]
}
```

Notes:
- `available_now` is **Wakerley warehouse sellable stock** (net of sold-waiting
  and display) — the same number 360's buying report trusts.
- `incoming` lists open purchase-order shipments (qty remaining + ETA).
- Excluded automatically: inactive products, hidden ranges (Salt Sun Sand),
  special-order-only items, products with no SKU.
- **No cost prices are ever in this feed** (verified on the 360 side).
- The token lives in 360's `settings.trade_api_token`. Treat it as a secret:
  server-side fetch only, never expose to the browser.

### Phase-2 contract (SPEC — to be built on 360 when the portal needs it)

When the portal starts taking orders for 360-sourced products, 360 will expose:

- `POST /api/trade/orders` — body: customer {name, email, phone, address},
  lines [{sku, qty, unit_price_inc_gst}], portal_order_ref. Creates a sale in
  360's **Trade / Commercial branch** (source-tagged `trade_portal`), which
  reserves/decrements 360 stock and returns `{ sale_number }`.
- `POST /api/trade/orders/:sale_number/payments` — relay payments recorded in
  the portal so 360's ledger stays whole.

**Until phase 2 exists**: portal orders for 360 products do NOT move 360 stock.
Mitigate by (a) re-syncing stock frequently, (b) flagging low-stock lines for
manual confirmation, and (c) the trade team keying large orders into 360
manually (they do this today with Shopify orders). Build phase 1 fully working
this way; the ordering API slots in later without redesign.

## Shopify bundle sync (✅ built)

Lounge packages built with Shopify's **native Bundles app** sync into the
portal via the Admin GraphQL API (`app/lib/shopify.server.ts`):

- Auth: OAuth (new Shopify Dev Dashboard apps — client id + `shpss_` secret).
  Settings keys `shopify_domain`, `shopify_client_id`, `shopify_client_secret`
  (secret); "Connect to Shopify" (/admin/shopify/connect → callback verifies
  state + HMAC, exchanges the code) stores the access token in
  `shopify_admin_token`. A manually-issued shpat token pasted into that
  settings row also works — the sync only reads `shopify_admin_token`.
- Bundles land as products with `source = 'shopify'`; component SKUs + qtys
  go to `bundle_components`. Same rules as the 360 sync: trade_price and
  override-flagged copy never touched; vanished bundles → `discontinued_at`.
- **Bundle `available_now` is computed**, not synced:
  min(floor(component stock / qty)), 0 if any component is missing from the
  portal or discontinued. `recomputeBundleStock` runs after BOTH syncs.
- Storefront product page shows "What's included" (names + qtys, no prices);
  rides the same 15-min cron ("Sync bundles" button for manual runs).
- Component SKUs in Shopify must match 360 SKUs — mismatches show on the
  bundle's admin edit page as "not found in portal catalogue".

## Portal data model (its own Postgres)

- `products` — sku (unique), name, category, description, images, trade_price,
  rrp_reference, source ('shack360' | 'portal'), active, plus cached
  `available_now`, `incoming` (jsonb), `stock_synced_at`. 360-sourced rows are
  refreshed by sync; portal rows are fully editable. ✅ built (+ `sync_runs`
  history table)
- `customers` — trade accounts: business name, ABN, contacts, addresses,
  price_tier, credit_terms, login (email + password hash or magic link),
  approved (bool — new registrations need admin approval before seeing prices).
  ✅ built (+ business_type; separate `__tp_trade` cookie session)
- `orders` + `order_items` — status flow: draft → submitted → confirmed →
  picking → dispatched → completed (+ cancelled). Keep `sale_number_360`
  nullable for phase 2 linkage.
- `payments` — per order: method, amount, reference; support part-payments.
  **No credit accounts** — orders are invoiced and paid (EFT) before
  dispatch; the team records payments in admin. Don't say "pay on account"
  anywhere customer-facing.
- `users` — admin-panel users (the trade team), role-based (admin / staff). ✅ built
- `settings` — key/value, mirroring 360's pattern. ✅ built

## The sync job (heart of the integration) — ✅ built (milestone 2)

`app/lib/sync.server.ts`. Worker cron fires every 15 min; a sync runs when
`stock_sync_minutes` (settings, default 30) has elapsed — plus a "Sync now"
button on the products page (bypasses the interval). Each run is recorded in
`sync_runs`. jsonb params MUST go through `db.json(...)` (a pre-stringified
value stores a jsonb string, not an array). The rules:

1. Fetch `/api/trade/products` from 360.
2. Upsert by SKU where `source = 'shack360'`: update name, category, images,
   dimensions, rrp_reference, `available_now`, `incoming`, `stock_synced_at`.
3. New SKUs appear as **inactive** portal products in an admin "New from 360"
   review list — the trade team sets a trade price and activates them
   (never auto-publish without a price).
4. SKUs that vanish from the feed → mark `discontinued_at`, hide from the
   storefront, flag in admin (don't delete — order history references them).
5. Never overwrite: trade_price, portal descriptions the team has customised
   (track an `overrides` jsonb of locally-edited fields), or portal-only rows.

## Admin panel scope (phase 1)

- Dashboard: today's orders, low stock on active lines, pending registrations.
- Products: list/search; edit trade price + portal copy; activate/deactivate;
  add portal-only products; "New from 360" review queue; sync status + button;
  row tick-boxes with bulk activate/deactivate/price-at-default on selection.
- Categories (`category_settings` table, /admin/categories): rename raw 360
  categories for the storefront (`display_name`; same display name merges
  tiles) and hide whole categories (`hidden`). Admin works in raw 360 names;
  ALL storefront queries must join category_settings (see store.server.ts).
- Customers: approve registrations, set tiers/terms, view order history.
- Orders: list by status, order detail, record payments (incl. part-payments),
  status transitions, packing slip / invoice PDF (GST invoice — ABN, GST
  breakdown).
- Settings: company details, email templates, price tiers, API token config.

## Storefront scope (phase 1)

- Public: brochure pages, product gallery WITHOUT prices, "apply for a trade
  account" form.
- Logged-in trade customer: prices visible, stock indicators ("In stock" /
  "Low" / "Incoming — ETA Aug"), cart → submit order (no online card payment in
  phase 1 — orders land in admin and are invoiced; payment upfront by EFT,
  no credit accounts), order history + statuses, reorder button.
- Phase 2+: Stripe for card-paying customers, live stock via the orders API.

## Emails (use Resend, same as 360)

Order submitted (customer + trade team), order confirmed, dispatched,
registration received/approved. Domain-verified sender.

## Non-negotiables

- **GST: all prices are stored inc-GST; ex-GST is derived for display**
  (`ex = inc / 1.1`). This is the documented choice — do not store ex-GST.
  Invoices show GST correctly.
- Trade prices and the feed token are never in client-side JS. Anything
  touching the DB or secrets lives in `*.server.ts` modules.
- Australian formats: DD/MM/YYYY, AUD, phone formats.
- Timezone: Australia/Brisbane for all business logic (360 does the same).
- Every screen assumes iPad-width usage by the trade team.

## Build order (milestones)

1. ✅ Scaffold + auth (admin users) + settings. **(done)**
2. ✅ Sync job + products admin. **(done — deployed with cron trigger;
   products list/filters/search, "New from 360" queue, edit with trade price +
   copy overrides, portal-only products, Sync now button)**
3. ✅ Storefront browse with trade login + pricing. **(done — public home
   with category tiles + gallery without prices, /trade/apply ABN
   application → admin approval queue (/admin/customers), trade login,
   gated pricing + stock bands ("In stock"/"Low"/"Incoming — ETA")
   with "stock as at" timestamp. IMPORTANT: unapproved visitors get
   products through `scrubProductForPublic` — loader data is serialised
   into HTML, so trade prices must be stripped server-side, never just
   hidden in the UI.)**
4. Cart → order submission → admin order management + payments.
5. Invoicing PDFs + emails.
6. Phase 2: 360 orders API integration (coordinate with the 360 side — the
   contract above is the starting point; confirm before building).

---

## Project conventions (how this repo is laid out)

- `workers/app.ts` — Worker entry; passes `{ cloudflare: { env, ctx } }` as the
  React Router `AppLoadContext`. The `Env` interface lives in `env.d.ts`.
- `app/routes.ts` — explicit route config (`@react-router/dev/routes`).
- `app/routes/admin/*` — admin panel. `layout.tsx` is the authed shell
  (requires a logged-in user); `login/setup/logout` sit outside it.
- `app/lib/*.server.ts` — server-only code: `db.server.ts` (postgres.js client
  from the Hyperdrive binding), `auth.server.ts` (PBKDF2-SHA256 password
  hashing via WebCrypto, cookie sessions, `requireUser`), `settings.server.ts`.
- `app/components/ui/` — shadcn-style primitives (button, input, card, …).
  Add new ones in the same style; `cn()` is in `app/lib/utils.ts`.
- Loaders/actions use `LoaderFunctionArgs`/`ActionFunctionArgs` from
  `react-router` and read `context.cloudflare.env`.
- `migrations/*.sql` — numbered, append-only SQL migrations, applied by
  `npm run db:migrate` (needs `DATABASE_URL`; tracks `schema_migrations`).
  Never edit an applied migration — add a new file.

### Commands

- `npm run dev` — local dev (workerd via the Cloudflare Vite plugin). Needs
  Postgres reachable via the Hyperdrive `localConnectionString` in
  `wrangler.jsonc` (or `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`)
  and a `.dev.vars` (copy `.dev.vars.example`).
- `npm run build` / `npm run deploy` — build / deploy with wrangler.
- `npm run typecheck` — react-router typegen + `tsc --noEmit`.
- `npm run db:migrate` — apply pending migrations (`DATABASE_URL` env var).

### Auth model (built in milestone 1)

- Admin users in `users` (role `admin` | `staff`, `active` flag). Passwords are
  PBKDF2-SHA256 (100k iterations, WebCrypto) — no native bcrypt on Workers.
- Sessions are signed HTTP-only cookies (`createCookieSessionStorage`,
  secret from `SESSION_SECRET` — `.dev.vars` locally, wrangler secret in prod).
- First run: `/admin/setup` creates the first admin (only while `users` is
  empty). After that, admins manage users at `/admin/users`. Only `admin` role
  can manage users and settings.

### Settings keys in use

`company_name`, `company_abn`, `company_phone`, `company_email`,
`company_address`, `trade_api_url`, `trade_api_token` (secret — write-only in
the UI), `stock_sync_minutes`, `trade_discount_percent` (default 37.5),
`shopify_domain`, `shopify_admin_token` (secret — write-only in the UI).
Read/write via `settings.server.ts`, which upserts key/value rows.

### Setup on the 360 side (already live — Tim just enables the token)

```sql
INSERT INTO settings (key, value) VALUES ('trade_api_token', '<long random string>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Test: `curl "https://shack360.app/api/trade/products?token=<token>" | head`
