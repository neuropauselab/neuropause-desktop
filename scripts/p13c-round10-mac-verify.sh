#!/usr/bin/env bash
#
# PROGRAM 13C — ROUND 10
# NATIVE MAC VERIFICATION — PHASES 22, 23, 24
#
# Run this ON THE MAC, from the repository root:
#
#     bash scripts/p13c-round10-mac-verify.sh
#
# It writes every result to  P13C-ROUND10-MAC-RESULTS.txt  in the repo root.
# Paste that file back.
#
# WHAT THIS SCRIPT CAN AND CANNOT DO — read this before running.
#
# Phase 22 (native build) is FULLY AUTOMATED below. It is the part a script can
# actually prove.
#
# Phases 23 and 24 — real multi-organization runtime and restart persistence —
# require a human to drive the application UI. A script cannot sign in, create a
# second organization, or switch tenants. So the second half of this file is a
# CHECKLIST, and it asks you to record PASS / FAIL / BLOCKED / NOT TESTED for
# each line. Leave anything you did not do as NOT TESTED. Do not mark a line
# PASS because it "should" work — the entire point of ten rounds of this program
# is that things that should work have not.
#
set -uo pipefail

OUT="P13C-ROUND10-MAC-RESULTS.txt"
: > "$OUT"

say() { echo "$@" | tee -a "$OUT"; }
run() {
  local label="$1"; shift
  say ""
  say "=== $label ==="
  say "\$ $*"
  if "$@" >>"$OUT" 2>&1; then
    say "--> PASS ($label)"
    return 0
  else
    say "--> FAIL ($label)  [exit $?]"
    return 1
  fi
}

say "PROGRAM 13C — ROUND 10 — NATIVE MAC VERIFICATION"
say "Started: $(date)"
say ""
say "--- ENVIRONMENT ---"
say "macOS:     $(sw_vers -productVersion 2>/dev/null || echo unknown)"
say "Arch:      $(uname -m)"
say "Node:      $(node -v 2>/dev/null || echo MISSING)"
say "npm:       $(npm -v 2>/dev/null || echo MISSING)"
say "Repo HEAD: $(git rev-parse HEAD 2>/dev/null || echo unknown)"
say "Branch:    $(git branch --show-current 2>/dev/null || echo unknown)"
say "Worktree:  $(if [ -z "$(git status --porcelain 2>/dev/null)" ]; then echo clean; else echo DIRTY; fi)"

# ─────────────────────────────────────────────────────────────────────────────
# PHASE 22 — NATIVE BUILD AND FULL AUTOMATED GATES
# ─────────────────────────────────────────────────────────────────────────────

say ""
say "############################################################"
say "# PHASE 22 — NATIVE MAC BUILD + AUTOMATED GATES"
say "############################################################"

run "install dependencies"        npm ci
run "typecheck (all workspaces)"  npm run typecheck:release
run "lint"                        npm run lint
run "desktop main tests"          npx vitest run src/main --reporter=basic --root apps/desktop
run "renderer + shared tests"     npx vitest run src/renderer src/shared --root apps/desktop
run "desktop build"               npm run build -w @neuropause/desktop

# The backend bundle is the gate that has failed in the Linux container every
# round because of an esbuild host/binary skew. THIS is the environment where it
# is meant to be verified, so its result here is the real one.
run "backend build (tsup)"        npm run build -w @neuropause/backend

say ""
say "--- SECURITY SUITES (named individually so a silent skip is visible) ---"
for suite in \
  src/main/tenancy/storeScopeGate.test.ts \
  src/main/tenancy/resolverAttachment.test.ts \
  src/main/tenancy/round10OrgOwnership.test.ts \
  src/main/tenancy/round10AuthorityPrincipal.test.ts \
  src/main/tenancy/round10InboxWebhookRetention.test.ts \
  src/main/tenancy/round10RunsMemoryIsolation.test.ts \
  src/main/tenancy/round10RetentionBatch1.test.ts \
  src/main/tenancy/round10RetentionBatch2.test.ts \
  src/main/tenancy/round10RetentionBatch3a.test.ts \
  src/main/tenancy/round10BackupPluginAuthority.test.ts \
  src/main/tenancy/round10PrincipalsChannels.test.ts \
  src/main/tenancy/marketplaceOwnership.test.ts \
  src/main/tenancy/eventDeliveryTenancy.test.ts \
  src/main/tenancy/connectorLogTenancy.test.ts \
  src/main/tenancy/desktopSessionTenancy.test.ts \
  src/main/tenancy/liveSyncTenancy.test.ts \
  src/main/tenancy/channelAuthorityTenancy.test.ts \
  src/main/tenancy/retentionScopeTenancy.test.ts
do
  run "suite $(basename "$suite")" npx vitest run "$suite" --root apps/desktop
done

say ""
say "############################################################"
say "# PHASE 22 RESULT"
say "############################################################"
say "Count the FAIL lines above. Any FAIL means Phase 22 did not pass."
say "If 'backend build (tsup)' failed HERE, that is a real finding, not the"
say "container skew — record it as FAIL."

# ─────────────────────────────────────────────────────────────────────────────
# PHASES 23 + 24 — HUMAN CHECKLIST
# ─────────────────────────────────────────────────────────────────────────────

cat >> "$OUT" <<'CHECKLIST'


############################################################
# PHASE 23 — REAL MULTI-ORGANIZATION RUNTIME
# PHASE 24 — RESTART / PERSISTENCE
#
# A script cannot drive the UI. Do these by hand and write
# PASS / FAIL / BLOCKED / NOT TESTED after each line.
#
# Launch with:   npm run dev
# (or open the built app from  out/ )
#
# LEAVE ANYTHING YOU DID NOT DO AS "NOT TESTED".
# Do not write PASS for something you did not observe.
############################################################

--- SETUP: three real organizations with DIFFERENT data ---
[    ] Sign in and complete first-run
[    ] Organization A exists
[    ] Organization B exists
[    ] Organization C exists

    The counts matter. A test where every org has the same amount of data
    cannot tell isolation from coincidence. Use 3 / 7 / 11.

[    ] In A: create 3 connectors, 3 automations, 3 documents/records
[    ] In B: create 7 connectors, 7 automations, 7 documents/records
[    ] In C: create 11 connectors, 11 automations, 11 documents/records
[    ] Give each org at least one AI/assistant interaction so memory is non-empty

--- PHASE 23a: WHAT EACH ORGANIZATION SEES ---
[    ] While in A: connector count reads exactly 3 (not 21, not 0)
[    ] While in B: connector count reads exactly 7
[    ] While in C: connector count reads exactly 11
[    ] Dashboard / Executive Center totals match the active org only
[    ] Timeline shows only the active org's events
[    ] Notifications inbox shows only the active org's items
[    ] AI memory recall in A returns A's content and no B or C content
[    ] Search in A returns no B or C records
[    ] Audit log in A shows no B or C actors

--- PHASE 23b: TENANT SWITCHING WITH BACKGROUND WORK RUNNING ---
    Start a connector sync (or any long job) in A, then switch while it runs.

[    ] Switch A -> B while A's sync is running
[    ] B's counts stay exactly 7 during A's sync
[    ] No A notification, toast or event appears while B is on screen
[    ] macOS Notification Center shows no A record names while B is active
      (this one is worth checking explicitly — it survives the switch)
[    ] Switch B -> A: A's counts are still exactly 3
[    ] Switch A -> C -> A repeatedly; counts never drift

--- PHASE 23c: CROSS-TENANT ATTACKS FROM THE UI ---
[    ] As B, try to open a URL/deep link naming an A record — refused
[    ] As B, marketplace shows A's PUBLISHED listings but no A drafts
[    ] As B, try to roll back / edit an A listing — refused
[    ] As an org Admin (not platform operator): plugin grant/revoke — REFUSED
[    ] As an org Admin: workforce install/uninstall — REFUSED
[    ] As an org Admin: marketplace install of a worker package — REFUSED
[    ] As an org Admin: backup create/restore — REFUSED
[    ] As an org Admin: app install/uninstall (nps) — REFUSED

    NOTE: until this round, the platform-operator predicate was never wired,
    so every one of those refused EVERYONE including operators. It is wired
    now. If you have a platform operator configured, verify the positive case
    too — otherwise record it as NOT TESTED rather than assuming.

[    ] As a PLATFORM OPERATOR: the same operations are ALLOWED
      (or: NOT TESTED — no operator configured)

--- PHASE 23d: RETENTION UNDER LOAD (the class this round fixed) ---
    This is the highest-value manual check in the list.

[    ] Note B's exact notification count and C's exact count
[    ] In A, generate 250+ notifications (a failing connector sync will do it)
[    ] B's notification count is UNCHANGED
[    ] C's notification count is UNCHANGED
[    ] In A, generate heavy webhook/automation traffic
[    ] B's delivery history and dead-letter queue are UNCHANGED
[    ] In A, create many ERP/CRM records (past the 50,000 cap if feasible)
[    ] B can still CREATE a record and it PERSISTS (this is the one that
      silently deleted the row it had just written)

--- PHASE 24: RESTART / PERSISTENCE ---
[    ] Quit the application completely (Cmd-Q, verify the process is gone)
[    ] Relaunch
[    ] A's data is intact and still exactly 3
[    ] B's data is intact and still exactly 7
[    ] C's data is intact and still exactly 11
[    ] No org's data appears under another org after restart
[    ] Connector credentials still work (vault survived)
[    ] Automations still scheduled and owned by the right org
[    ] Audit/timeline history intact per org
[    ] The app STARTS AT ALL — two new startup assertions run before any
      handler is registered (assertAllTenantStoresBound,
      assertAllStoreScopesBound). If a store is unbound the app refuses to
      start, by design. A failure to launch here is a REAL FINDING: record it.

--- ANYTHING ELSE ---
Write below anything that looked wrong, slow, confusing, or surprising —
including UI problems that are not security. A round that only records what it
went looking for finds only what it already knew.



############################################################
# END — paste this whole file back
############################################################
CHECKLIST

say ""
say "############################################################"
say "Automated phase complete. Results written to: $OUT"
say ""
say "NOW: open $OUT, complete the Phase 23 / 24 checklist by hand,"
say "and paste the whole file back."
say "############################################################"
