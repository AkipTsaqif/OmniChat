import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@/db/schema";

/**
 * Prefer the project-scoped variable. A globally exported `DATABASE_URL`
 * (common on dev machines) outranks `.env.local` in Next's env precedence,
 * which silently points the app at the wrong database — the project-scoped
 * name avoids that collision entirely.
 */
const connectionString =
  process.env.OMNICHAT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "OMNICHAT_DATABASE_URL is not set. Add it to .env.local.",
  );
}

export const dbHost = new URL(connectionString).host;

export const db = drizzle(neon(connectionString), { schema });
export { schema };
