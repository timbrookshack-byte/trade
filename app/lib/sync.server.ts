import type { Sql } from "./db.server";

/**
 * The 360 product sync — the heart of the integration (CLAUDE.md).
 *
 * Pulls /api/trade/products from Shack360 and upserts by SKU into the portal's
 * products table. Rules enforced here:
 *  - Only rows with source='shack360' are ever touched; portal-only rows are
 *    mastered locally and skipped even on SKU collision.
 *  - trade_price is NEVER written by sync, and fields listed in `overrides`
 *    (locally-edited copy) are preserved.
 *  - New SKUs land inactive with no trade price → the "New from 360" queue.
 *  - SKUs missing from the feed get discontinued_at set (never deleted);
 *    if a SKU returns, the flag is cleared.
 */

interface FeedProduct {
  sku: string;
  name: string;
  category?: string | null;
  description?: string | null;
  rrp_inc_gst?: number | null;
  dimensions?: string | null;
  cbm?: number | null;
  weight_kg?: number | null;
  image_url?: string | null;
  store_link?: string | null;
  available_now?: number | null;
  incoming?: { qty: number; eta: string; status: string }[] | null;
}

export interface SyncResult {
  status: "success" | "error" | "skipped";
  productsInFeed?: number;
  created?: number;
  updated?: number;
  discontinued?: number;
  error?: string;
}

const UPSERT_CHUNK = 100;

export async function runSync(db: Sql, trigger: "cron" | "manual"): Promise<SyncResult> {
  const settings = Object.fromEntries(
    (
      await db<{ key: string; value: string }[]>`
        SELECT key, value FROM settings WHERE key IN ('trade_api_url', 'trade_api_token')
      `
    ).map((r) => [r.key, r.value]),
  );
  const url = settings.trade_api_url;
  const token = settings.trade_api_token;
  if (!url || !token) {
    return {
      status: "error",
      error: "Trade API URL or token not configured — set them in Settings.",
    };
  }

  const [run] = await db<{ id: number }[]>`
    INSERT INTO sync_runs (trigger) VALUES (${trigger}) RETURNING id
  `;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`360 API responded ${response.status} ${response.statusText}`);
    }
    const feed = (await response.json()) as { products?: FeedProduct[] };
    const products = (feed.products ?? []).filter((p) => p.sku && p.name);

    let created = 0;
    let updated = 0;

    const now = new Date();
    for (let i = 0; i < products.length; i += UPSERT_CHUNK) {
      const chunk = products.slice(i, i + UPSERT_CHUNK).map((p) => ({
        sku: p.sku,
        source: "shack360",
        name: p.name,
        category: p.category ?? "",
        description: p.description ?? "",
        dimensions: p.dimensions ?? "",
        cbm: p.cbm ?? null,
        weight_kg: p.weight_kg ?? null,
        image_url: p.image_url ?? "",
        store_link: p.store_link ?? "",
        rrp_reference: p.rrp_inc_gst ?? null,
        available_now: Math.max(0, Math.trunc(p.available_now ?? 0)),
        // Must go through db.json — a pre-stringified value would be stored
        // as a jsonb *string*, not an array.
        incoming: db.json(p.incoming ?? []),
        stock_synced_at: now,
      }));

      const rows = (await db`
        INSERT INTO products ${db(
          chunk,
          "sku",
          "source",
          "name",
          "category",
          "description",
          "dimensions",
          "cbm",
          "weight_kg",
          "image_url",
          "store_link",
          "rrp_reference",
          "available_now",
          "incoming",
          "stock_synced_at",
        )}
        ON CONFLICT (sku) DO UPDATE SET
          name = CASE WHEN products.overrides ? 'name' THEN products.name ELSE EXCLUDED.name END,
          description = CASE WHEN products.overrides ? 'description' THEN products.description ELSE EXCLUDED.description END,
          category = EXCLUDED.category,
          dimensions = EXCLUDED.dimensions,
          cbm = EXCLUDED.cbm,
          weight_kg = EXCLUDED.weight_kg,
          image_url = EXCLUDED.image_url,
          store_link = EXCLUDED.store_link,
          rrp_reference = EXCLUDED.rrp_reference,
          available_now = EXCLUDED.available_now,
          incoming = EXCLUDED.incoming,
          stock_synced_at = EXCLUDED.stock_synced_at,
          discontinued_at = NULL,
          updated_at = now()
        WHERE products.source = 'shack360'
        RETURNING (xmax = 0) AS inserted
      `) as unknown as { inserted: boolean }[];
      for (const row of rows) {
        if (row.inserted) created++;
        else updated++;
      }
    }

    // Flag 360 products that vanished from the feed. Never delete — order
    // history will reference them.
    const feedSkus = products.map((p) => p.sku);
    const gone =
      feedSkus.length > 0
        ? await db<{ sku: string }[]>`
            UPDATE products
            SET discontinued_at = now(), updated_at = now()
            WHERE source = 'shack360'
              AND discontinued_at IS NULL
              AND sku NOT IN ${db(feedSkus)}
            RETURNING sku
          `
        : [];

    await db`
      UPDATE sync_runs SET
        finished_at = now(),
        status = 'success',
        products_in_feed = ${products.length},
        created_count = ${created},
        updated_count = ${updated},
        discontinued_count = ${gone.length}
      WHERE id = ${run.id}
    `;

    return {
      status: "success",
      productsInFeed: products.length,
      created,
      updated,
      discontinued: gone.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db`
      UPDATE sync_runs SET finished_at = now(), status = 'error', error = ${message}
      WHERE id = ${run.id}
    `;
    return { status: "error", error: message };
  }
}

/**
 * Cron entry point. The cron fires every 15 minutes; an actual sync only runs
 * when at least `stock_sync_minutes` (settings, default 30) have passed since
 * the last successful one.
 */
export async function runScheduledSync(db: Sql): Promise<SyncResult> {
  const [intervalRow] = await db<{ value: string }[]>`
    SELECT value FROM settings WHERE key = 'stock_sync_minutes'
  `;
  const intervalMinutes = Math.max(5, Number(intervalRow?.value) || 30);

  const [last] = await db<{ started_at: string }[]>`
    SELECT started_at FROM sync_runs
    WHERE status = 'success'
    ORDER BY started_at DESC
    LIMIT 1
  `;
  if (last) {
    const elapsedMs = Date.now() - new Date(last.started_at).getTime();
    // Small grace so a 30-min interval isn't skipped by a cron firing at 29:59.
    if (elapsedMs < (intervalMinutes - 2) * 60_000) {
      return { status: "skipped" };
    }
  }
  return runSync(db, "cron");
}

export async function getLastSyncRuns(db: Sql, limit = 5) {
  return db<
    {
      id: number;
      started_at: string;
      finished_at: string | null;
      trigger: string;
      status: string;
      products_in_feed: number | null;
      created_count: number | null;
      updated_count: number | null;
      discontinued_count: number | null;
      error: string | null;
    }[]
  >`
    SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ${limit}
  `;
}
