/**
 * Drizzle Postgres client (postgres-js driver against Supabase).
 *
 * Use the Supabase pooler URL on port 6543 in production for connection
 * reuse under serverless concurrency. `prepare: false` is required for
 * pgbouncer transaction-mode pooling.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Set it in .env.local (see .env.example).",
  );
}

const queryClient = postgres(databaseUrl, { prepare: false });

export const db = drizzle(queryClient, { schema });
export { schema };
