// Apply 0004: assessment_visibility enum + assessments.visibility column.
// Idempotent on re-run.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync("drizzle/0004_orange_caretaker.sql", "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = postgres(url, { connect_timeout: 15 });
try {
  for (const [i, stmt] of statements.entries()) {
    console.log(`[apply] ${i + 1}/${statements.length}:`, stmt.replace(/\s+/g, " ").slice(0, 100));
    try {
      await sql.unsafe(stmt);
    } catch (err) {
      // 42710 = duplicate enum, 42701 = duplicate column
      if (err.code === "42710" || err.code === "42701") {
        console.log("  (already applied, skipping)");
      } else {
        throw err;
      }
    }
  }
  const sample = await sql`SELECT id, title, status, visibility FROM assessments LIMIT 3`;
  console.log("[apply] visibility populated:");
  console.table(sample);
} finally {
  await sql.end({ timeout: 2 });
}
