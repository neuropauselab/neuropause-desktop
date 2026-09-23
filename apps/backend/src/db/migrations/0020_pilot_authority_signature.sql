-- =========================================================================================
-- NP-PILOT-FIRST-036 — OPTION_B, external cryptographic root.
--
-- OPTION_B's normative "smallest change" (sealed NP-022 13-authority-root-design-space.md):
--   "add `signature` and `signer_key_id` columns to `pilot_authority_decisions`, a pilot
--    trust file scoped away from `production-release`, and verify in `loadAuthorityDecisions`
--    before the snapshot is built."
--
-- These are the two columns. They are NULLABLE ON PURPOSE, and that is not a weakness:
-- an unsigned row is not admitted by the loader, so nullability is what lets an unsigned row
-- EXIST and be REFUSED rather than being rejected at write time by a credential that could
-- drop the constraint anyway. NP-023 measured that the runtime credential is the migration
-- credential and holds DDL: a NOT NULL here would be a control the forging party can remove.
-- The verification lives in code that the same party would have to redeploy, not in a
-- constraint they can DROP in one statement.
--
-- NO OTHER COLUMN IS ADDED. NP-036 §9 requires only the fields OPTION_B actually names, and
-- §11 lists security fields (subject, scope, appointment reference, instrument version...)
-- that DO NOT EXIST on this table. Adding them would be inventing governance semantics for
-- fields no human instrument defines. The gap is recorded in the evidence package instead.
-- =========================================================================================

ALTER TABLE pilot_authority_decisions ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE pilot_authority_decisions ADD COLUMN IF NOT EXISTS signer_key_id text;

COMMENT ON COLUMN pilot_authority_decisions.signature IS
  'base64 Ed25519 signature over the np-pilot-authority-v1 canonical form. NULL = unsigned = not admitted.';
COMMENT ON COLUMN pilot_authority_decisions.signer_key_id IS
  'sha256 of the signing key SPKI DER, hex. Must name a key in the pilot trust file.';
