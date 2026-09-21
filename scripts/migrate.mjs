import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";

import { readDatabaseUrl } from "./env.mjs";

const sql = neon(readDatabaseUrl());

const dir = "drizzle";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

await sql`CREATE TABLE IF NOT EXISTS _migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

const done = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name));

for (const file of files) {
  if (done.has(file)) {
    console.log(`skip  ${file}`);
    continue;
  }
  const body = fs.readFileSync(path.join(dir, file), "utf8");
  // drizzle separates independent statements with this breakpoint marker
  const statements = body
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.query(statement);
  }
  await sql`INSERT INTO _migrations (name) VALUES (${file})`;
  console.log(`apply ${file} (${statements.length} statements)`);
}

const tables = await sql`
  SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`;
console.log("tables:", tables.map((t) => t.tablename).join(", "));
