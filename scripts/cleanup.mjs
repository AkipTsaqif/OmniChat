import { neon } from "@neondatabase/serverless";
import { readDatabaseUrl } from "./env.mjs";
const sql = neon(readDatabaseUrl());
const r = await sql`DELETE FROM users WHERE email LIKE 'probe%@example.com' OR email LIKE 'shot%@example.com' OR email LIKE 'models%@example.com' OR email LIKE 'dbg%@example.com' OR email LIKE 'pending%@example.com' OR email LIKE 'btn%@example.com' OR email LIKE 'dev%@example.com' OR email LIKE 'share%@example.com' OR email LIKE 'hyd%@example.com' OR email LIKE 'tools%@example.com' OR email LIKE 'abort%@example.com' OR email LIKE 'stream%@example.com' OR email LIKE 'health%@example.com' RETURNING email`;
console.log("removed test accounts:", r.length);
const u=await sql`SELECT count(*)::int n FROM users`;
const c=await sql`SELECT count(*)::int n FROM conversations`;
const s=await sql`SELECT count(*)::int n FROM provider_settings`;
console.log(JSON.stringify({users:u[0].n,conversations:c[0].n,providerSettings:s[0].n}));
