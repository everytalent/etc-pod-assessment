-- Candidates turned away because their specialisation had no usable
-- validation bank yet.
--
-- The candidate-facing copy has always promised "we'll email you the
-- moment it's ready", and until now nothing recorded who had been told
-- that, so the email could never be sent. This is the record that makes
-- the promise keepable: a row per (candidate, specialisation) the
-- moment they are turned away, cleared when they have been emailed.

CREATE TABLE IF NOT EXISTS validation_waitlist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    text NOT NULL,
  candidate_email text NOT NULL,
  candidate_name  text,
  specialisation  text NOT NULL,
  -- Why they could not be assessed: 'unknown' (no skillboard) or
  -- 'empty_bank' (board live, no questions yet).
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  notified_at     timestamptz
);

-- One open row per candidate per specialisation: repeated attempts while
-- they wait must not queue up duplicate emails.
CREATE UNIQUE INDEX IF NOT EXISTS validation_waitlist_pending_unique
  ON validation_waitlist (candidate_id, specialisation)
  WHERE notified_at IS NULL;

-- The notifier sweeps by specialisation for rows still owed an email.
CREATE INDEX IF NOT EXISTS validation_waitlist_pending_idx
  ON validation_waitlist (specialisation)
  WHERE notified_at IS NULL;
