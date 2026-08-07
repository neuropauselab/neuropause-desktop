# NeuroPause — Pending Commits (built overnight, commit in the morning)

**Branch HEAD is `0d585d3` (C2b, already committed + pushed).**
Everything below is **saved in your working tree** and bridge-gated (typecheck + eslint pass), but **NOT committed yet**. Run each block top-to-bottom in the morning.

**Golden rule:** each block ends with the full local gate. **If the gate fails, STOP and ping Claude before committing.** Your safe demo baseline (C1 + C2a + C2b) is already committed, so a failed gate here never risks the demo.

---

## 0. One-time cleanup

A file got created at the wrong path during the build and was moved aside. It's untracked junk — delete it:

```bash
cd /Users/saurabhpatel/Desktop/neuropause-desktop
rm -rf _stray_to_delete
```

---

## 1. C2c — FX Exposure module (#95)   ⚠️ certification bump 94 → 95

Immutable point-in-time FX exposure snapshots: netted exposure by currency + per-customer (AR) and per-vendor (AP) breakdowns, marked to the latest rate. Read-only (books no journal entries). Registered as certified module #95.

**Files in this commit:**
- `apps/desktop/src/main/enterprise/modules/finance/fxExposureModule.ts` (new — the module)
- `apps/desktop/src/main/enterprise/modules/finance/fxExposureModuleInstance.ts` (new — singleton)
- `apps/desktop/src/main/enterprise/modules/finance/fxExposureModule.test.ts` (new — 3 tests)
- `apps/desktop/src/main/enterprise/index.ts` (registration: +2 lines)
- `apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts` (cert lock: Finance 19→20, count 94→95)

**Gate (MUST pass — cert is now 95; expect ~5536 tests):**

```bash
cd /Users/saurabhpatel/Desktop/neuropause-desktop
npm run typecheck -w @neuropause/shared && npm run typecheck -w @neuropause/desktop && npm test && npm run build -w @neuropause/desktop
```

> If `npm test` fails on the **certification / module count** (e.g. "expected 95"), the cert bump needs a look — **ping Claude, don't commit.** Everything else is standard.

**Commit + push:**

```bash
git add \
  apps/desktop/src/main/enterprise/modules/finance/fxExposureModule.ts \
  apps/desktop/src/main/enterprise/modules/finance/fxExposureModuleInstance.ts \
  apps/desktop/src/main/enterprise/modules/finance/fxExposureModule.test.ts \
  apps/desktop/src/main/enterprise/index.ts \
  apps/desktop/src/main/enterprise/modules/moduleCertification.test.ts

git commit -m "feat(finance): W6-C2c FX exposure module (#95) — immutable point-in-time exposure snapshots surfacing netted exposure by currency plus per-customer (AR) and per-vendor (AP) breakdowns marked to the latest registered rate; read-only (books no journal entries); derives foreign cash positions from the posted ledger like the revaluation; registered + certified (Finance 19->20, registry 94->95)"

git push
[ "$(git rev-parse HEAD)" = "$(git rev-parse @{u})" ] && echo "HEAD==origin OK" || echo "MISMATCH"
git status --short
```

**CI:** watch the new commit's `desktop-ci` + `backend-ci`; re-run if GitHub can't acquire a runner (the overnight outage should be over by morning).

---

## Next increments — NOT yet built (Claude builds these on request)

Say "continue" / "build C2d" and Claude picks up here, one atomic increment at a time:

- **C2d** — realized FX (period P&L from account 7810) + historical exposure trend (from the immutable reval snapshots). Finishes Stage C2.
- **C3** — Company functional-currency configuration (INR / USD / EUR / GBP / AED / SGD), replacing the hardcoded USD constant, without changing the accounting engine.
- **C4** — Budget Forecast engine (rolling / scenario / department / cash / revenue / expense / variance).
- **C5** — Intercompany accounting (Due To / Due From / intercompany journals / settlement / eliminations).
- **C6** — Consolidation engine (parent/subsidiary, consolidated BS/P&L/CF, minority interest, currency translation).

Stages D–J (installer, updater, security, observability, deployment/SSO, docs, pilot) come after Stage C, and several need inputs only you can provide (Apple + Windows code-signing certs; Azure AD / Google / Okta tenants). Start procuring those in parallel.
