-- Soft delete for tenant assessment banks. The tenant's "delete
-- assessment" action sets this timestamp; the row is retained for
-- audit and for the candidate slot ledger's referential integrity.
-- All tenant-facing queries filter on deleted_at IS NULL.
ALTER TABLE tenant_assessment_bank
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS tenant_assessment_bank_deleted_at_idx
  ON tenant_assessment_bank (tenant_id, deleted_at);
