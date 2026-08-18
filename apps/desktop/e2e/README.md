# Slice-14 — real-Electron governed-loop e2e (mock Graph only)

`mailSend.e2e.cjs` launches the SEEDED e2e build and drives the REAL UI through the certified `mail.send` loop.
**TEST-VERIFIED at the real-application level — NOT LIVE.** No real credentials, no OAuth consent, no real external
send. Microsoft Graph is answered by an in-process mock; no `VERIFIED_SUCCESS` is claimed.

## Run

```bash
cd apps/desktop
# 1) Build the e2e-capable app (the seed seam is compiled in ONLY with this flag):
NP_E2E_BUILD=1 npx electron-vite build
# 2) Drive the loop (NODE_PATH lets the script resolve playwright-core from the repo root):
NODE_PATH="$(git rev-parse --show-toplevel)/node_modules" NEUROPAUSE_E2E=1 node e2e/mailSend.e2e.cjs
```

Exit 0 = all assertions passed. Artifacts (screenshots + `trace.zip`) land in `e2e/artifacts/` (git-ignored;
regenerated each run). Open the trace with `npx playwright show-trace e2e/artifacts/trace.zip`.

## Scenarios

- **S14-A POSITIVE** — NL turn → `mailIntent` → hand-off → Connector Center → `M365WritePanel` proposal → Confirm →
  certified executor → mock Graph → ACKNOWLEDGED; governed effect evidenced at the UI **and** the main-process layer.
- **S14-B HOSTILE-CONTEXT** — an injection-style turn with no legitimate user send → no intent, no proposal, no execute.
- **S14-C AMBIGUITY** — a send-shaped turn with no literal recipient → the assistant ASKS → no proposal, no execute.

## Safety of the seed seam

The seed (`src/main/e2e/e2eSeed.ts`) can forge an authenticated principal + a governed account and mock Graph. It is
**structurally absent from release builds**: gated behind the compile-time `__NP_E2E__` define (false unless
`NP_E2E_BUILD=1`) AND the runtime `NEUROPAUSE_E2E=1` flag. `scripts/verify-e2e-strip.sh` proves a plain
`electron-vite build` contains none of it — **run it in the standing regression + the release/distribution checklist.**
An e2e-capable build stamps its version + window title `-e2e` so it cannot masquerade as a release.
