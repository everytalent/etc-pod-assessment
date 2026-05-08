// Quick row count diagnostic — confirms seed landed.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 15 });
try {
  const rows = await sql`
    SELECT
      (SELECT COUNT(*) FROM assessments)     AS assessments,
      (SELECT COUNT(*) FROM questions)       AS questions,
      (SELECT COUNT(*) FROM branching_rules) AS branching_rules,
      (SELECT COUNT(*) FROM responses)       AS responses,
      (SELECT COUNT(*) FROM answers)         AS answers
  `;
  console.table(rows);
} finally {
  await sql.end({ timeout: 2 });
}
