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
- `rrp_inc_gst` is the FULL list RRP, never a promo price (360-side fix
  2026-09): 360 keeps a per-SKU `rrp` from Shopify's compare-at ("was")
  price and the feed sends `GREATEST(rrp, sell_price)`, so a retail sale
  can't deflate trade pricing. Before this fix some RRPs synced 20% low —
  the "Price ≠ default" filter + "Re-price at default (overwrites)" bulk
  action on the admin products page exist to find and correct trade prices
  set from bad RRPs.
- The token lives in 360's `settings.trade_api_token`. Treat it as a secret:
  server-side fetch only, never expose to the browser.

### Phase-2 orders contract (AGREED 2026-07 — portal side ✅ built, 360 side to build)

**The flow (Tim's decision): 360 masters the order once pushed.** A portal
order lands in 360 as an *unconfirmed quote*; the trade team edits/confirms it
IN 360; the portal mirrors 360's version back (lines, prices, freight, status)
so the customer's order page and invoice always show the corrected truth.

Lifecycle: portal `submitted` → pushed → 360 quote → team confirms in 360 →
portal pulls → portal `confirmed` (+ email w/ payment options) → 360
dispatch/complete flows through the same mirror. Auth for all endpoints: same
`trade_api_token` (Bearer or `?token=`), server-side only.

360 must expose (portal client already built in `three60-orders.server.ts`):

1. `POST /api/trade/orders` — body:
   ```json
   { "portal_order_ref": "TP-1005",
     "customer": { "business_name", "contact_name", "email", "phone",
                   "delivery_method", "delivery_address", "urgent_date" },
     "note": "…",
     "lines": [ { "sku": "SDS23991UDCT", "name": "…", "qty": 2,
                  "unit_price_inc_gst": 186.88,
                  "components": [ { "sku": "…", "qty": 1 } ] } ] }
   ```
   Creates an **unconfirmed quote** in the Trade/Commercial branch,
   source-tagged `trade_portal`. NO stock movement at this stage (stock
   reserves when the team confirms the sale in 360, per 360's normal rules).
   Unknown SKUs (portal-only products / Shopify bundles) become free-text
   lines; bundle lines carry `components` so the team can explode them.
   **Idempotent on portal_order_ref** — a retry returns the existing sale.
   Returns `{ "sale_number": "…" }`.
2. `GET /api/trade/orders/:sale_number` — the mirror source. Returns:
   ```json
   { "sale_number": "…", "portal_order_ref": "TP-1005",
     "status": "quote|confirmed|dispatched|completed|cancelled",
     "lines": [ { "sku": "", "name": "Freight — Brisbane", "qty": 1,
                  "unit_price_inc_gst": 150 } ],
     "total_inc_gst": 4000.88, "updated_at": "…" }
   ```
   `lines` is the FULL current sale (edits, freight and fees included —
   freight is just a line with an empty/none sku). The portal polls this on
   its 15-min cron for open pushed orders + a "Refresh from 360" button.
   **Conversion-following (360 v001.498)**: confirming a quote in 360 creates
   a successor invoice and marks the quote converted; the endpoint follows the
   conversion and reports the live invoice's state, with `current_sale_number`
   carrying the new number (+ `amount_paid`/`balance_due`). The portal ADOPTS
   `current_sale_number` into `sale_number_360` on pull, so the admin banner
   and payment relays reference the live invoice.
3. `POST /api/trade/orders/:sale_number/payments` — body
   `{ amount, method, reference, paid_at, portal_order_ref }`: relay of a
   payment recorded in the portal, so 360's ledger stays whole. 360 side:
   idempotent on `reference`, honours `paid_at` for the trading day, excluded
   from till EOD, and accepts either the quote's or successor invoice's number.
- (still requested, separate) `POST /api/trade/customers` — upsert portal
  trade customers into 360 (by email/ABN). Contract to be agreed later.

Portal behaviour (all ✅ built, gated by settings `orders_360_enabled='true'`):
push on order submit (cron retries failures); mirror overwrites portal lines
+ status wholesale (portal never edits a pushed order's lines locally);
confirmed/dispatched emails fire on mirrored transitions exactly as on manual
ones; payments recorded in admin relay to 360 (fire-and-forget, cron-safe).
**Until 360 ships + the flag is on**: orders behave as phase 1 (no 360 touch,
team keys sales into 360 manually).

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
  go to `bundle_components`. Override-flagged copy never touched; vanished
  bundles → `discontinued_at`.
- **Bundle classification**: title contains "stylist" → `Cushion Packages`,
  everything else → `Lounge Packages` (Shopify productType is ignored —
  it's blank on these). Manual category overrides still win.
- **Bundle pricing is COMPUTED from components** (`recomputeBundlePricing`,
  runs after both syncs): RRP = Σ component RRP × qty; trade price =
  Σ component trade_price × qty. Skipped when any component lacks a trade
  price or when `overrides.trade_price` is set (a manual price edit or
  "apply default" on a bundle sets that flag). New bundles activate on
  arrival once priced; the stock rule can pull them straight back off.
- **Bundle `available_now` is computed**, not synced:
  min(floor(component stock / qty)), 0 if any component is missing from the
  portal or discontinued. `recomputeBundleStock` runs after BOTH syncs.
  **Bundle `incoming` is DERIVED from component container shipments** (same
  recompute): at each component ETA, how many MORE complete sets become
  buildable (entries `{qty, eta, status: "components"}`; leftover from
  undated shipments gets `eta: ""`). This keeps the stock auto-toggle from
  deactivating a bundle that's fully on the water and drives the
  storefront's "Incoming — ETA" band on packages.
- Storefront product page shows "What's included" (names + qtys, no prices);
  rides the same 15-min cron ("Sync bundles" button for manual runs).
- Component SKUs in Shopify must match 360 SKUs — mismatches show on the
  bundle's admin edit page as "not found in portal catalogue".
- **Description enrichment**: NON-bundle Shopify products are SKU-matched to
  shack360 rows and their (richer) copy replaces the 360 description, with
  `overrides.description = "shopify"` (360 sync skips it, Shopify sync keeps
  it fresh). A manual admin edit sets `overrides.description = true` and
  beats both syncs. Shopify HTML converts to STRUCTURED text (blank-line
  paragraphs, `## ` headings, `• ` bullets — `htmlToStructuredText`), rendered
  by `app/components/rich-text.tsx` on the product page; admin textareas can
  use the same conventions (hint shown under the description field).
- **Image galleries**: the sync pulls ALL Shopify media (up to 20, deduped)
  into `products.images` (jsonb array) — for bundles and for SKU-matched 360
  products alike. Gallery data is Shopify-maintained like stock (no overrides
  involved). 360's `image_url` is LOW-RES: display always prefers the Shopify
  gallery — `productPhoto()` in products.ts / `images->>0` in SQL — falling
  back to `image_url` only when no gallery exists, and the product-page
  gallery drops the 360 photo entirely when Shopify images are present. The
  storefront product page shows main image + clickable thumbnails. NB when comparing jsonb in
  postgres.js guards, the param must go through `db.json(...)` too — a plain
  string double-encodes to a jsonb string and never matches.

## Dining sets (✅ built — configurable bundles from Shopify's DSB)

Shopify's dining set builder (see DSBEXPORTSPEC: shell products with
`custom.dsb_*` metafields + `dining_set_chair_option` metaobjects) syncs into
`dining_sets` / `dining_set_chairs` (`app/lib/dining.server.ts`, sync_runs
kind `dining_sets`, rides the Shopify cron + "Sync dining sets" button on
/admin/dining-sets). Key decisions:

- Every product reference resolves to VARIANT SKUS at sync time; pricing and
  stock come from the portal catalogue (360 is the stock truth — Shopify's
  §4 availability metafields are ignored as derivative).
- Only ACTIVE chair-option metaobjects sync; metafield order = display order,
  first option pre-selected. Vanished shells → `discontinued_at`, never
  deleted. `dining_sets.active` is portal-owned (hide/show in admin).
- Storefront: /dining-sets (+ nav link that appears only when sets exist) and
  /dining-sets/:slug configurator — hero swaps to the option's composite
  photo, chair colour + table variant dropdowns when >1, qty pills, price =
  table + chair × qty (ex-first; scrubbed for public), per-component stock
  bands, table+chair description sections.
- **Add to cart = two REAL line items** (table SKU × 1, chair SKU × qty) —
  the set is never carted, so orders, invoices and the 360 push work
  natively. The action re-validates the configuration server-side.
- OAuth scope is now `read_products,read_metaobjects,read_files` — after
  deploying a scope change, RECONNECT Shopify from Settings.

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
- `orders` + `order_items` — status flow: quote → submitted → confirmed →
  picking → dispatched → completed (+ cancelled); 'quote' is an admin-built
  order that hasn't been placed (branded Quotation doc, convertible).
  `sale_number_360` stays nullable for phase 2 linkage. ✅ built (cart is a
  signed cookie, orders snapshot customer + line prices at submit)
- `payments` — per order: method, amount, reference; support part-payments.
  **No credit accounts** — orders are invoiced and paid (EFT) before
  dispatch; the team records payments in admin. Don't say "pay on account"
  anywhere customer-facing. ✅ built
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
  tiles), hide whole categories (`hidden`), set a custom tile image
  (`image_url`; blank = best-stocked product's photo), and add manual
  categories for portal-only products. Admin works in raw 360 names;
  ALL storefront queries must join category_settings (see store.server.ts).
  Products can ALSO appear in extra categories: `products.extra_categories`
  (jsonb array of raw names, portal-owned, sync never touches) — set via
  "Also show in" checkboxes on the product edit page; storefront tiles,
  category pages, admin category filter and category detail all include them.
- Customers: approve registrations, set tiers/terms, view order history;
  sortable columns (business/applied/last login/last order); CSV import
  (/admin/customers/import — Orderspace export compatible; imported rows are
  approved with NO password) + per-customer invite links (`password_resets`
  tokens → /trade/set-password, 14-day expiry, emailed when Resend is
  configured). `customers.last_login_at` is stamped on every login.
  Self-serve forgot-password: /trade/forgot (linked from login) emails a
  24-hour single-use reset link via the same password_resets table; the
  response never reveals whether an email has an account.
- Orders: list by status, order detail, record payments (incl. part-payments),
  status transitions, packing slip / invoice PDF (GST invoice — ABN, GST
  breakdown).
- Settings: company details, email templates, price tiers, API token config.

## Storefront scope (phase 1)

- Public: brochure pages, product gallery WITHOUT prices, "apply for a trade
  account" form. ✅ plus content pages: /about (settings-driven copy),
  /faq (faqs table, accordions), /projects + /projects/:slug (projects table
  — case studies with galleries; drafts 404 until published), /contact
  (form → contact_messages + team email; honeypot field for bots). Team
  edits everything under /admin/content, /admin/projects, /admin/messages.
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
  Invoices show GST correctly. **Customer-facing display leads with ex-GST**
  (trade convention): gallery cards, product detail, cart lines, order pages
  and product sheets show ex first with inc secondary; totals boxes and tax
  documents always show the full ex/GST/inc breakdown.
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
4. ✅ Cart → order submission → admin order management + payments. **(done —
   storefront cart/checkout, account order history + reorder, admin orders
   list/detail with status flow + payment recording + low-stock line flags,
   quote builder from product selection with editable lines)**
5. ✅ Invoicing PDFs + emails. **(done — Tax Invoice / Packing slip /
   Quotation print-to-PDF docs at /admin/orders/:id/doc; Resend emails for
   registration received/approved, order submitted (customer + team),
   confirmed, dispatched — settings resend_api_key (secret), email_from,
   email_notify; emails no-op silently when unconfigured)**
6. Phase 2: 360 orders API integration. **(portal side ✅ built & tested
   against a mock — push on submit/convert, cron retry + mirror, Refresh
   button, payment relay, settings flag `orders_360_enabled` (default off).
   Waiting on the 360 project to build the three endpoints in the contract
   above, then flip the flag in Settings.)**

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
`shopify_domain`, `shopify_admin_token` (secret — write-only in the UI),
`resend_api_key` (secret), `email_from`, `email_notify`,
`payment_phone`, `payment_account_name`, `payment_bsb`,
`payment_account_number`, `payment_remittance_email` (payment options —
defaults hardcoded in `app/lib/payment.ts`; shown on invoices, customer
order pages, /faq#payment and order emails; policy: payment in full prior
to dispatch, card by phone Visa/MC no fee / AMEX 1.95%, direct deposit
with order number as REF + remittance advice email).
Read/write via `settings.server.ts`, which upserts key/value rows.

### Setup on the 360 side (already live — Tim just enables the token)

```sql
INSERT INTO settings (key, value) VALUES ('trade_api_token', '<long random string>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Test: `curl "https://shack360.app/api/trade/products?token=<token>" | head`
