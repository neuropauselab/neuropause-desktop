# Backup forensics — there is no production data, and there never was

**13 August 2026** · Program 13C · measured, not inferred.

---

## Method

`pg_restore` in the analysis container is 16 and refuses the archives —
`unsupported version (1.16) in file header` — and the egress proxy blocks
`postgresql.org`, so the PostgreSQL 18 client could not be installed.

Rather than report the check as unrunnable, the custom-format archive was parsed
directly: header, TOC, and then every data block inflated and its COPY stream
counted. Two small readers, no server involved. The row counts below are decoded
from the dump bytes themselves.

---

## What the archives are

```
archive version   1.16-0   format=custom   compression=zlib
database          nems
server / pg_dump  18.4 / 18.4
newest dump taken 2026-08-03 02:15:01 UTC
TOC entries       278
```

The schema is complete and healthy: **36 tables**, 57 constraints, 56 indexes,
50 foreign keys, 16 triggers, 5 functions, 3 extensions, 36 `TABLE DATA`
sections. Nothing is truncated and nothing is corrupt. As an archive, the
newest dump is perfectly restorable.

---

## What is inside it

| dump | total rows | non-empty tables |
|---|---|---|
| `2026/07/30T162327Z` (1.02 KiB) | 0 | none — dumped `defaultdb`, pre-migration |
| `2026/07/30T164304Z` | **12** | `schema_migrations` = 12 |
| `2026/07/31T021503Z` | **12** | `schema_migrations` = 12 |
| `2026/08/01T021503Z` | **12** | `schema_migrations` = 12 |
| `2026/08/02T021503Z` | **12** | `schema_migrations` = 12 |
| `2026/08/03T021503Z` | **12** | `schema_migrations` = 12 |

Every other table is empty in every dump:

> `users` · `organizations` · `memberships` · `workspaces` · `devices` ·
> `auth_identities` · `auth_sessions` · `auth_tokens` · `applications` ·
> `developers` · `installations` · `subscriptions` · `audit_log` ·
> `connector_accounts` · `sync_state` · `embedding_state` · and 19 more

**Zero users. Zero organizations. Zero tenants. Zero audit entries.** The only
rows in production were the twelve migration records the schema writes about
itself.

`TABLE DATA` appearing 36 times in the TOC means nothing on its own — `pg_dump`
emits a data section for empty tables too. Counting the decompressed rows is the
only thing that answers the question, which is why this file exists.

---

## Consequences

**1. Nothing was at risk.** The bucket queued for deletion on 18 August held no
customer data. Cancelling it was still right — nobody knew — but the outcome is
that the recovery had nothing to recover.

**2. The rebuild does not need a restore.** `deploy/kubernetes/migrate-job-production.yaml`
regenerates those twelve rows from the committed migrations in seconds.
Restoring the dump and running the migrate Job produce the same database. The
restore step, the PG-18-major-version constraint it imposed, and
`deploy/backup/pg-restore-job.yaml` all drop out of the plan.

**3. The five identical 106.23 KiB dumps are explained.** Sizes were identical
from 30 July to 3 August because the content never changed. It never changed
because nothing ever wrote to it.

**4. It reframes the founder test.** Even with the backend healthy, there was no
account for him. `/auth/providers` returns `[]` (no OAuth configured), so
`POST /auth/email/register` was the only way in — against an empty `users` table.
F-4 blocked him at the sign-in screen; behind that screen there was nothing to
sign in to.

---

## What this does to Program 13C

This is §2's evidence pattern — *a status assigned by counting a proxy that was
easier to measure than the thing* — at the largest scale it has appeared in this
program.

Every multi-tenant property the certification cares about — tenant RBAC,
cross-tenant reads, cross-tenant mutations, F22 tenant-domain honesty, runtime
ownership, queue identity, retention — describes behaviour **between tenants**.
Production has never held one tenant, let alone two. The gate row
*"Real A/B/C tenants — NOT TESTED"* was already honest; what was not visible
until now is that it could not have been otherwise, because the production
database has been empty for its entire existence.

Nothing here changes a gate verdict. It changes what the untested gates mean:
they are not a backlog of checks someone forgot to run, they are checks that had
no subject.

**PROGRAM 13C = NOT CERTIFIED**, unchanged.

---

## The artefacts

Keep all six dumps. They are worth nothing as data and quite a lot as evidence:
they are the only surviving record of what production actually was.

Verified with two readers written for this analysis:
`pgdump-toc.js` (header + TOC) and `pgdump-rows.js` (inflate data blocks, count
COPY rows). Both are deterministic, take the archive path, and can be re-run by
anyone who wants to check this rather than believe it.
