#!/usr/bin/env bash
# NP-PILOT-FIRST-015 §§14,19,37 — database trust-boundary measurement.
#
# MEASURES ONLY. Creates a DISPOSABLE PostgreSQL instance with THREE DISTINCT SQL identities and
# reports which of them can manufacture a pilot authority row. It changes nothing in this
# repository and touches no production system.
#
# NP-014 could not answer this: its disposable instance had ONE role that owned every table, so
# "the application credential can forge authority" was true of that setup by construction.
# Separating the identities is what makes the question answerable.
#
# Usage: tools/np015-db-trust-boundary.sh [container-name] [host-port]
set -uo pipefail
C="${1:-np015-tb}"; PORT="${2:-55445}"
psql_as () { local r="$1" pw="$2"; shift 2; docker exec -e PGPASSWORD="$pw" "$C" psql -U "$r" -d np015 -h 127.0.0.1 -tAc "$@" 2>&1 | tail -1; }
priv () { docker exec "$C" psql -U np015_boot -d np015 -tAc "SELECT has_table_privilege('$1','$2','$3');"; }

docker rm -f "$C" >/dev/null 2>&1
docker run -d --name "$C" -e POSTGRES_USER=np015_boot -e POSTGRES_PASSWORD=boot -e POSTGRES_DB=np015 -p "$PORT":5432 postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do docker exec "$C" pg_isready -q 2>/dev/null && break; sleep 1; done

# Extensions must be pre-provisioned by a superuser: 0001_init.sql and 0002_store.sql issue
# CREATE EXTENSION (pgcrypto, citext, pg_trgm), which a non-superuser migration role cannot run.
docker exec "$C" psql -U np015_boot -d np015 -q \
  -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";' -c 'CREATE EXTENSION IF NOT EXISTS "citext";' \
  -c 'CREATE EXTENSION IF NOT EXISTS "pg_trgm";' >/dev/null
docker exec "$C" psql -U np015_boot -d np015 -q \
  -c "CREATE ROLE np015_migrate LOGIN PASSWORD 'm' CREATEDB;" \
  -c "CREATE ROLE np015_app LOGIN PASSWORD 'a';" \
  -c "CREATE ROLE np015_dba LOGIN PASSWORD 'd' SUPERUSER;" \
  -c "GRANT ALL ON SCHEMA public TO np015_migrate;" -c "GRANT USAGE ON SCHEMA public TO np015_app;" >/dev/null

echo "== applying migrations as np015_migrate (NOT as the application role) =="
DATABASE_URL="postgres://np015_migrate:m@localhost:$PORT/np015" npx tsx src/db/migrate.ts >/dev/null 2>&1 \
  && echo "   migrations applied" || { echo "   MIGRATION FAILED"; exit 1; }

echo "== applying LEAST PRIVILEGE to the application role =="
docker exec "$C" psql -U np015_migrate -d np015 -q \
  -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO np015_app;" \
  -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO np015_app;" \
  -c "REVOKE INSERT, UPDATE, DELETE ON pilot_role_bindings, pilot_authority_decisions FROM np015_app;" >/dev/null
echo "   app INSERT on pilot_role_bindings       = $(priv np015_app pilot_role_bindings INSERT)"
echo "   app SELECT on pilot_role_bindings       = $(priv np015_app pilot_role_bindings SELECT)"
echo "   app INSERT on pilot_enrollments         = $(priv np015_app pilot_enrollments INSERT)"

docker exec "$C" psql -U np015_migrate -d np015 -q -c \
  "INSERT INTO users (id,email,password_hash) VALUES ('eeee0000-0000-4000-8000-000000000001','p@np015.invalid','x') ON CONFLICT DO NOTHING;" >/dev/null

echo "== M-DB-01 direct INSERT of a role binding, per SQL identity =="
echo "   np015_app     : $(psql_as np015_app a  "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('eeee0000-0000-4000-8000-000000000001','FIRST_PILOT_HUMAN_DECISION_AUTHORITY','FORGE-APP');")"
echo "   np015_migrate : $(psql_as np015_migrate m "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('eeee0000-0000-4000-8000-000000000001','PILOT_OPERATOR_TECHNICAL_OPERATIONS','FORGE-MIG');")"
echo "   np015_dba     : $(psql_as np015_dba d "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('eeee0000-0000-4000-8000-000000000001','INDEPENDENT_PILOT_VERIFIER','FORGE-DBA');")"

echo "== M-DB-02 set authenticated=true on an authority decision =="
docker exec "$C" psql -U np015_migrate -d np015 -q -c \
  "INSERT INTO pilot_authority_decisions (instrument,actions,environment_class,effective_from) VALUES ('FORGE-BASE',ARRAY['pilot.cap.set'],'PILOT',now());" >/dev/null
echo "   np015_app     : $(psql_as np015_app a "UPDATE pilot_authority_decisions SET authenticated=true;")"
echo "   np015_dba     : $(psql_as np015_dba d "UPDATE pilot_authority_decisions SET authenticated=true;")"

echo "== ESCALATION vectors available to the application role =="
echo "   self-GRANT INSERT   : $(psql_as np015_app a "GRANT INSERT ON pilot_role_bindings TO np015_app;")  -> privilege now = $(priv np015_app pilot_role_bindings INSERT)"
echo "     (postgres prints GRANT and WARNING 'no privileges were granted'; VERIFY THE EFFECT,"
echo "      never the keyword - the exit word alone would read as a successful escalation)"
echo "   SET ROLE migrate    : $(psql_as np015_app a "SET ROLE np015_migrate;")"
echo "   ALTER TABLE OWNER   : $(psql_as np015_app a "ALTER TABLE pilot_role_bindings OWNER TO np015_app;")"
echo "   DROP TABLE          : $(psql_as np015_app a "DROP TABLE pilot_role_bindings;")"

echo "== RLS: whom does it actually constrain? =="
docker exec "$C" psql -U np015_migrate -d np015 -q -c "ALTER TABLE pilot_role_bindings ENABLE ROW LEVEL SECURITY;" -c "ALTER TABLE pilot_role_bindings FORCE ROW LEVEL SECURITY;" >/dev/null
echo "   owner under FORCE RLS, no policy : $(psql_as np015_migrate m "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('eeee0000-0000-4000-8000-000000000001','FIRST_PILOT_HUMAN_DECISION_AUTHORITY','RLS-OWNER');")"
echo "   SUPERUSER under FORCE RLS        : $(psql_as np015_dba d "INSERT INTO pilot_role_bindings (subject_id,role,decision_ref) VALUES ('eeee0000-0000-4000-8000-000000000001','FIRST_PILOT_HUMAN_DECISION_AUTHORITY','RLS-DBA');")"
echo "   owner disables FORCE again       : $(psql_as np015_migrate m "ALTER TABLE pilot_role_bindings NO FORCE ROW LEVEL SECURITY;")"

echo "== result =="
echo "   rows manufactured in pilot_role_bindings: $(docker exec "$C" psql -U np015_boot -d np015 -tAc 'SELECT count(*) FROM pilot_role_bindings;')"
echo "   (disposable instance; remove with: docker rm -f $C)"
