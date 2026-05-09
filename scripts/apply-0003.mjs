// Apply 0003: extend admin_role enum with editor + assessor.
// Idempotent — uses IF NOT EXISTS for the ADD VALUE.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync("drizzle/0003_wandering_leo.sql", "utf8");
// Drizzle generates plain ALTER TYPE ADD VALUE — we replace with the
// IF NOT EXISTS variant so re-runs are safe.
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) =>
    s.replace(/ADD VALUE '/g, "ADD VALUE IF NOT EXISTS '"),
  );

const sql = postgres(url, { connect_timeout: 15 });
try {
  for (const [i, stmt] of statements.entries()) {
    console.log(`[apply] ${i + 1}/${statements.length}:`, stmt);
    await sql.unsafe(stmt);
  }
  const values = await sql`
    SELECT enumlabel FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'admin_role')
    ORDER BY enumsortorder
  `;
  console.log("[apply] admin_role enum values:");
  console.table(values);
} finally {
  await sql.end({ timeout: 2 });
}
