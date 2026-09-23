#!/usr/bin/env bash
# NP-PILOT-FIRST-016 section 12 — database trust matrix, EFFECTS not exit codes.
#
# Every cell is decided by observing what actually changed (row counts, has_table_privilege,
# pg_class/pg_constraint state), never by a command's exit status or its success keyword.
# NP-015 recorded why: a non-owner GRANT prints the word GRANT and a WARNING, and confers
# nothing. Reading the keyword would have reported a false escalation.
#
# Usage: tools/np016-db-role-matrix.sh <container> <port>
set -uo pipefail
C="${1:-np016-pg}"; PORT="${2:-55450}"
SUBJ='aaaa0000-0000-4000-8000-000000000001'

pw () { case "$1" in np016_app) echo a;; np016_migrate) echo m;; np016_dba) echo d;; *) echo boot;; esac; }
# Run SQL as a role; we DISCARD its output deliberately - the verdict comes from a separate
# effect measurement made as a neutral superuser.
as () { docker exec -e PGPASSWORD="$(pw "$1")" "$C" psql -U "$1" -d np016 -h 127.0.0.1 -tAc "$2" >/dev/null 2>&1; }
obs () { docker exec "$C" psql -U np016_boot -d np016 -tAc "$1" 2>/dev/null | tr -d ' '; }

bindings () { obs "SELECT count(*) FROM pilot_role_bindings;"; }
decisions () { obs "SELECT count(*) FROM pilot_authority_decisions;"; }

# effect <role> <label> <sql> <observer-before-expr> : prints YES if the observation changed
effect () {
  local role="$1" label="$2" sql="$3" obs_expr="$4"
  local before after
  before=$(obs "$obs_expr")
  as "$role" "$sql"
  after=$(obs "$obs_expr")
  if [ "$before" != "$after" ]; then echo "YES"; else echo "no"; fi
}

reset_rows () {
  docker exec "$C" psql -U np016_boot -d np016 -q \
    -c "DELETE FROM pilot_role_bindings;" -c "DELETE FROM pilot_authority_decisions;" >/dev/null 2>&1
}

printf '%-34s %-8s %-8s %-8s\n' "OPERATION (effect-measured)" "app" "migrate" "dba"
printf '%-34s %-8s %-8s %-8s\n' "----------------------------------" "-----" "-------" "-----"

# 1. read binding  (privilege is the effect here; reading changes nothing)
printf '%-34s' "read binding"
for R in np016_app np016_migrate np016_dba; do
  printf '%-8s' "$(obs "SELECT has_table_privilege('$R','pilot_role_bindings','SELECT');" | sed 's/^t$/YES/;s/^f$/no/')"
done; echo

# 2. insert binding
printf '%-34s' "insert binding"
for R in np016_app np016_migrate np016_dba; do
  reset_rows
  printf '%-8s' "$(effect "$R" ins "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('$SUBJ','FIRST_PILOT_HUMAN_DECISION_AUTHORITY','NP016');" "SELECT count(*) FROM pilot_role_bindings;")"
done; echo

# 3. alter binding
printf '%-34s' "alter binding"
for R in np016_app np016_migrate np016_dba; do
  reset_rows
  docker exec "$C" psql -U np016_boot -d np016 -q -c "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('$SUBJ','FIRST_PILOT_HUMAN_DECISION_AUTHORITY','BASE');" >/dev/null 2>&1
  printf '%-8s' "$(effect "$R" upd "UPDATE pilot_role_bindings SET decision_ref='ALTERED';" "SELECT count(*) FROM pilot_role_bindings WHERE decision_ref='ALTERED';")"
done; echo

# 4. delete binding
printf '%-34s' "delete binding"
for R in np016_app np016_migrate np016_dba; do
  reset_rows
  docker exec "$C" psql -U np016_boot -d np016 -q -c "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('$SUBJ','FIRST_PILOT_HUMAN_DECISION_AUTHORITY','BASE');" >/dev/null 2>&1
  printf '%-8s' "$(effect "$R" del "DELETE FROM pilot_role_bindings;" "SELECT count(*) FROM pilot_role_bindings;")"
done; echo

# 5. insert authority decision
printf '%-34s' "insert authority decision"
for R in np016_app np016_migrate np016_dba; do
  reset_rows
  printf '%-8s' "$(effect "$R" insd "INSERT INTO pilot_authority_decisions (instrument,authenticated,actions,environment_class,effective_from) VALUES ('NP016',true,ARRAY['pilot.cap.set'],'PILOT',now());" "SELECT count(*) FROM pilot_authority_decisions;")"
done; echo

# 6. alter authority decision (set authenticated=true - the field meant to mean "a human signed")
printf '%-34s' "set authenticated=true"
for R in np016_app np016_migrate np016_dba; do
  reset_rows
  docker exec "$C" psql -U np016_boot -d np016 -q -c "INSERT INTO pilot_authority_decisions (instrument,actions,environment_class,effective_from) VALUES ('BASE',ARRAY['pilot.cap.set'],'PILOT',now());" >/dev/null 2>&1
  printf '%-8s' "$(effect "$R" auth "UPDATE pilot_authority_decisions SET authenticated=true;" "SELECT count(*) FROM pilot_authority_decisions WHERE authenticated;")"
done; echo

# 7. alter table (add a column)
printf '%-34s' "alter table"
for R in np016_app np016_migrate np016_dba; do
  docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings DROP COLUMN IF EXISTS np016_probe;" >/dev/null 2>&1
  printf '%-8s' "$(effect "$R" alt "ALTER TABLE pilot_role_bindings ADD COLUMN np016_probe int;" "SELECT count(*) FROM information_schema.columns WHERE table_name='pilot_role_bindings' AND column_name='np016_probe';")"
done
docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings DROP COLUMN IF EXISTS np016_probe;" >/dev/null 2>&1; echo

# 8. enable then drop RLS
printf '%-34s' "drop RLS once enabled"
for R in np016_app np016_migrate np016_dba; do
  docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings ENABLE ROW LEVEL SECURITY;" >/dev/null 2>&1
  printf '%-8s' "$(effect "$R" rls "ALTER TABLE pilot_role_bindings DISABLE ROW LEVEL SECURITY;" "SELECT relrowsecurity::text FROM pg_class WHERE relname='pilot_role_bindings';")"
done
docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings DISABLE ROW LEVEL SECURITY;" >/dev/null 2>&1; echo

# 9. change owner
# VACUITY FIX: the first version had each role attempt "OWNER TO <itself>". For np016_migrate,
# which ALREADY owns the table, that changes nothing and the effect test reported "no" - a
# vacuous pass read as a denial. Every role now attempts to hand ownership to the SAME third
# role (np016_app), from a baseline owner of np016_migrate, so the cells are comparable.
printf '%-34s' "give ownership to np016_app"
for R in np016_app np016_migrate np016_dba; do
  docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings OWNER TO np016_migrate;" >/dev/null 2>&1
  printf '%-8s' "$(effect "$R" own "ALTER TABLE pilot_role_bindings OWNER TO np016_app;" "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname='pilot_role_bindings';")"
done
docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings OWNER TO np016_migrate;" >/dev/null 2>&1; echo

# 10. bypass FORCE RLS (no policy => any insert must fail unless the role bypasses)
printf '%-34s' "insert under FORCE RLS, no policy"
docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings ENABLE ROW LEVEL SECURITY;" -c "ALTER TABLE pilot_role_bindings FORCE ROW LEVEL SECURITY;" >/dev/null 2>&1
for R in np016_app np016_migrate np016_dba; do
  reset_rows
  printf '%-8s' "$(effect "$R" bypass "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('$SUBJ','FIRST_PILOT_HUMAN_DECISION_AUTHORITY','RLS');" "SELECT count(*) FROM pilot_role_bindings;")"
done
docker exec "$C" psql -U np016_boot -d np016 -q -c "ALTER TABLE pilot_role_bindings NO FORCE ROW LEVEL SECURITY;" -c "ALTER TABLE pilot_role_bindings DISABLE ROW LEVEL SECURITY;" >/dev/null 2>&1; echo

# 11. self-GRANT: the trap. The keyword says GRANT; the EFFECT says nothing happened.
# Row label corrected: only the app row is a SELF-grant. For migrate and dba this measures
# "can this role grant the app INSERT", which is a different (and also interesting) question.
printf '%-34s' "grant app INSERT (effect)"
for R in np016_app np016_migrate np016_dba; do
  docker exec "$C" psql -U np016_boot -d np016 -q -c "REVOKE INSERT ON pilot_role_bindings FROM np016_app;" >/dev/null 2>&1
  printf '%-8s' "$(effect "$R" grant "GRANT INSERT ON pilot_role_bindings TO np016_app;" "SELECT has_table_privilege('np016_app','pilot_role_bindings','INSERT')::text;")"
done
docker exec "$C" psql -U np016_boot -d np016 -q -c "REVOKE INSERT,UPDATE,DELETE ON pilot_role_bindings, pilot_authority_decisions FROM np016_app;" >/dev/null 2>&1; echo

reset_rows
# HARNESS HYGIENE. Row 9 hands ownership away and back; PostgreSQL drops the GRANTs the previous
# owner had made, so np016_app silently loses SELECT on the table whose owner churned - and only
# on that table. The first run of this harness contaminated the NEXT measurement that way: a
# least-privilege probe reported "read authority bindings FAILED" and looked like a finding about
# the application when it was residue from this script. Restore the grant state explicitly.
docker exec "$C" psql -U np016_migrate -d np016 -q \
  -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO np016_app;" \
  -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO np016_app;" \
  -c "REVOKE INSERT, UPDATE, DELETE ON pilot_role_bindings, pilot_authority_decisions FROM np016_app;" >/dev/null 2>&1
echo
echo "final state: bindings=$(bindings) decisions=$(decisions)  (both must be 0)"
echo "grant state restored: app SELECT bindings=$(obs "SELECT has_table_privilege('np016_app','pilot_role_bindings','SELECT')::text;") INSERT=$(obs "SELECT has_table_privilege('np016_app','pilot_role_bindings','INSERT')::text;")"
