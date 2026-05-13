// Apply 0006: score_history table + answers.score_rationale column.
// Idempotent: existing tables/columns/constraints are skipped by SQLSTATE.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync(
  "drizzle/0006_mean_serpent_society.sql",
  "utf8",
);
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
  const summary = await sql`
    SELECT
      (SELECT COUNT(*) FROM score_history)::int AS history_rows,
      (
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'answers' AND column_name = 'score_rationale'
      )::int AS rationale_col
  `;
  console.log("[apply] verification:");
  console.table(summary);
} finally {
  await sql.end({ timeout: 2 });
}
