// One-shot: apply 0001 migration + seed superadmin row.
// Idempotent: ON CONFLICT prevents duplicate seed if rerun.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync("drizzle/0001_busy_dakota_north.sql", "utf8");
const statements = sqlText
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = postgres(url, { connect_timeout: 15 });
try {
  for (const [i, stmt] of statements.entries()) {
    console.log(`[apply] ${i + 1}/${statements.length}:`, stmt.replace(/\s+/g, " ").slice(0, 80), "…");
    await sql.unsafe(stmt);
  }
  console.log("[seed] superadmin: ugo@energytalentco.com");
  await sql`
    INSERT INTO admin_users (email, role)
    VALUES ('ugo@energytalentco.com', 'superadmin')
    ON CONFLICT (email) DO UPDATE SET role = 'superadmin'
  `;
  const rows = await sql`SELECT email, role, created_at FROM admin_users`;
  console.table(rows);
} finally {
  await sql.end({ timeout: 2 });
}
