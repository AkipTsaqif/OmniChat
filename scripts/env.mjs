import fs from "node:fs";

/**
 * Reads OMNICHAT_DATABASE_URL from .env.local. Deliberately ignores
 * process.env so a stray global DATABASE_URL cannot redirect migrations
 * or seeds at the wrong database.
 */
export function readDatabaseUrl() {
  const raw = fs.readFileSync(".env.local", "utf8");
  const match = raw.match(/^\s*OMNICHAT_DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)/m);
  if (!match) {
    throw new Error("OMNICHAT_DATABASE_URL not found in .env.local");
  }
  return match[1];
}
