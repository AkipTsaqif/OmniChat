import fs from "node:fs";
import { defineConfig } from "drizzle-kit";

// Read straight from .env.local so a stray global DATABASE_URL in the shell
// cannot point drizzle-kit at the wrong database.
const url = fs
  .readFileSync(".env.local", "utf8")
  .match(/^\s*OMNICHAT_DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)/m)?.[1];

if (!url) throw new Error("OMNICHAT_DATABASE_URL not found in .env.local");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
