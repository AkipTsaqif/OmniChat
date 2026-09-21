import { neon } from "@neondatabase/serverless";
import { readDatabaseUrl } from "./env.mjs";
const sql = neon(readDatabaseUrl());
const cols = await sql`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' ORDER BY table_name, ordinal_position`;
const byTable = {};
for (const c of cols) (byTable[c.table_name] ??= []).push(c.column_name);
console.log(JSON.stringify(byTable, null, 2));
