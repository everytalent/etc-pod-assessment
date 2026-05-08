import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` runs offline (no DB connection), so we accept a
 * placeholder URL when DATABASE_URL is unset. `push`, `migrate`, and `studio`
 * will fail loudly at connect time if the real URL is missing.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder",
  },
  verbose: true,
  strict: true,
});
