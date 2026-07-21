import type { AppLoadContext } from "react-router";

/**
 * Key/value settings, mirroring Shack360's pattern. Known keys are listed in
 * CLAUDE.md. `trade_api_token` is a secret: never send its value to the
 * browser — the settings UI treats it as write-only.
 */
export async function getSettings(context: AppLoadContext, keys?: string[]) {
  const sql = context.db;
  const rows = keys
    ? await sql<{ key: string; value: string }[]>`
        SELECT key, value FROM settings WHERE key IN ${sql(keys)}
      `
    : await sql<{ key: string; value: string }[]>`SELECT key, value FROM settings`;
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>;
}

export async function getSetting(context: AppLoadContext, key: string) {
  const settings = await getSettings(context, [key]);
  return settings[key] ?? null;
}

export async function setSettings(context: AppLoadContext, entries: Record<string, string>) {
  const pairs = Object.entries(entries);
  if (pairs.length === 0) return;
  await context.db.begin(async (tx) => {
    for (const [key, value] of pairs) {
      await tx`
        INSERT INTO settings (key, value)
        VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
    }
  });
}
