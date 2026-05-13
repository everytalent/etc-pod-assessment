// Apply 0008: response-level integrity deduction columns. Idempotent.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync("drizzle/0008_condemned_komodo.sql", "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const SKIP_CODES = new Set(["42P07", "42710", "42701"]);

const sql = postgres(url, { connect_timeout: 15 });
try {
  for (const [i, stmt] of statements.entries()) {
    console.log(
      `[apply] ${i + 1}/${statements.length}:`,
      stmt.replace(/\s+/g, " ").slice(0, 100),
    );
    try {
      await sql.unsafe(stmt);
    } catch (err) {
      if (SKIP_CODES.has(err.code)) {
        console.log(`  (already applied [${err.code}], skipping)`);
      } else {
        throw err;
      }
    }
  }
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'responses' AND column_name LIKE 'integrity_%'
    ORDER BY column_name
  `;
  console.log("[apply] integrity_* columns on responses:");
  console.table(cols);
} finally {
  await sql.end({ timeout: 2 });
}
