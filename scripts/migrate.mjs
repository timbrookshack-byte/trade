#!/usr/bin/env node
// Applies pending SQL migrations from migrations/ in filename order.
// Usage: DATABASE_URL=postgresql://... npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required, e.g. postgresql://postgres:postgres@localhost:5432/trade_portal");
  process.exit(1);
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT name FROM schema_migrations`).map((r) => r.name),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}…`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    ran++;
  }
  console.log(ran === 0 ? "Already up to date." : `Applied ${ran} migration(s).`);
} finally {
  await sql.end();
}
