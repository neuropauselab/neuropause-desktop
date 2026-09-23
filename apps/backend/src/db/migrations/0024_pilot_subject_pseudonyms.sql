-- =========================================================================================
-- NP-PILOT-FIRST — D13-D (P1). THE STABLE PSEUDONYM MAPPING.
--
-- The human D13 decision selects P1: "replace the direct participant/subject identifier with a
-- stable pseudonymous identifier, while preserving only the authorized longitudinal association
-- required by the first-pilot purpose." Not P2 — the subject link is NOT severed.
--
-- WHY A MAPPING TABLE AND A PSEUDONYM USER ROW. Every subject column D13 marks PSEUDONYMIZE is
-- `uuid NOT NULL REFERENCES users(id)`. A pseudonym must therefore itself be a uuid that exists
-- in `users`, or the foreign key fails. That is precisely why P1 is implementable where P2 was
-- not: NULL cannot satisfy those constraints and a pseudonym row can. No constraint is relaxed
-- and no foreign key is dropped.
--
-- STABILITY is structural, not conventional: subject_user_id is the PRIMARY KEY, so one subject
-- can only ever map to one pseudonym, and re-running retention resolves to the same row.
--
-- THIS TABLE IS THE RE-IDENTIFICATION MAPPING. D13 requires the authorized longitudinal
-- association to be preserved, which means the mapping must exist; it is therefore held in ONE
-- named place so that "where can a subject be recovered from" has a single answer. The
-- pseudonym's own email is random and is NOT derived from the subject id — `deleted_${users.id}@…`
-- (the account-deletion form) was measured to leak the id in the address itself, and is
-- deliberately not reused here.
--
-- The result is PSEUDONYMIZED. It is not anonymization and must never be described as such.
-- =========================================================================================

CREATE TABLE IF NOT EXISTS pilot_subject_pseudonyms (
  subject_user_id   uuid PRIMARY KEY REFERENCES users(id),
  pseudonym_user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_pseudonym_not_self CHECK (subject_user_id <> pseudonym_user_id)
);

COMMENT ON TABLE pilot_subject_pseudonyms IS
  'D13-D (P1) stable subject->pseudonym mapping. Holding it makes re-identification possible by design and in one place; the retained pilot rows carry only the pseudonym.';
