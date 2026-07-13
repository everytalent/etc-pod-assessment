-- Tenant-declared seniority and role location for a bank generation.
--
-- claimed_seniority: nullable. When null the analyser extracts a
-- seniority_hint from the JD/SOW text. When set, this overrides the
-- extracted hint so the question generator can bias the question-type
-- mix (senior → scenario/case-study, junior → MCQ).
--
-- role_location: nullable free text (city/country). Feeds the generator
-- so questions use the correct currency symbol, region-specific regs,
-- and local context. Not enum-constrained because tenants hire globally.
ALTER TABLE tenant_assessment_bank
  ADD COLUMN IF NOT EXISTS claimed_seniority seniority_band,
  ADD COLUMN IF NOT EXISTS role_location text;
