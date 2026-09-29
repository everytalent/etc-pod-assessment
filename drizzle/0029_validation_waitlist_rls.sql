-- ============================================================================
-- 0029 — validation_waitlist under row-level security
-- ============================================================================
-- 0028 created the waitlist after the tenant hardening in 0027, and missed
-- the step that every other table exposed to PostgREST has: RLS on, no
-- policies, so the anon and authenticated roles see nothing. The app reads
-- and writes it through the server-side Postgres connection, which bypasses
-- RLS, so nothing about the waitlist changes except that the public API
-- surface can no longer list who was turned away and why.
-- ============================================================================

ALTER TABLE "validation_waitlist" ENABLE ROW LEVEL SECURITY;
