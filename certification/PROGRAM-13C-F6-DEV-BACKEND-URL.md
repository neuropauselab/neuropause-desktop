# PROGRAM 13C — F-6 · A dev run can silently target production

**13 August 2026** · found while verifying the commands to start the app locally
· **corrected the same day** — see §Correction. Amends
`PROGRAM-13C-FINAL-CERTIFICATION.md` §1 (findings) and §2 (evidence pattern).

---

## Statement

If `apps/desktop/resources/build-info.json` carries a non-null `backendUrl`, then
`npm run dev` points the desktop application at that URL — in this product,
`https://api.neuropause033.com` — instead of the developer's local backend, with
no warning and nothing in `git status`.

The file is written at package time and left in the working tree. Whether a given
machine is affected depends entirely on whether `NEUROPAUSE_BACKEND_URL` was set
the last time that machine packaged.

Sign-in, token refresh, device registration, organizations, billing and catalog
all resolve through `config.backendUrl` (17 call sites), so on an affected tree a
developer believing they are testing locally is authenticating against, and
writing to, the production service.

---

## Correction — 13 August, same day

The first version of this record asserted that the team's macOS tree was affected
and that credentials typed into dev runs had been reaching production. **Both
claims were wrong and are withdrawn.**

What actually happened: the reproduction ran in a container whose copy of the tree
carried a `build-info.json` originating from the **Windows CI packaging run**
(`commit 259df3b`, `buildTime 2026-08-12T17:40:03Z`, `backendUrl:
"https://api.neuropause033.com"`). I read that file, confirmed the mechanism, and
then asserted the state of a machine I had not looked at.

The macOS machine's own file is `commit 8c570cd`, `buildTime
2026-08-12T12:27:31Z`, **`backendUrl: null`** — packaged without the env var set.
`getBakedBackendUrl()` returns null there, so it has always fallen through to
`http://127.0.0.1:4000`. Its dev run at 05:50Z on 13 Aug, taken *before* the fix
was applied, logged `Starting in development mode { backendUrl:
'http://127.0.0.1:4000' }`. That is the refutation, and it came from the operator's
terminal, not from me.

**This is the same failure this document was written to name.** §2 of the
certification records statuses assigned by counting a proxy easier to measure than
the thing. Here the proxy was *a file in my container copy* standing in for *the
file on the operator's disk*. Reading a mirror is not observing the machine.

Severity is therefore **latent, not active**: no known machine has been affected.
The trap arms the first time anyone runs `npm run package:win` or `package:mac`
locally with `NEUROPAUSE_BACKEND_URL` set — which is exactly what the release
workflows do — and it stays armed silently from then on.

---

## Mechanism

1. `apps/desktop/scripts/generate-build-info.cjs` writes
   `apps/desktop/resources/build-info.json` at package time. `backendUrl` is
   whatever `NEUROPAUSE_BACKEND_URL` held then — the production URL in CI, `null`
   when unset.
2. The file is **correctly gitignored** — `.gitignore` carries it under
   *"Generated at package time by generate-build-info.cjs; never commit"*. Being
   gitignored is exactly why it is invisible: never in `git status`, survives
   branch switches, survives `git clean` without `-x`.
3. `buildInfo.readGenerated()` resolves it through `app.getAppPath()`. Its header
   says *"absence is expected in dev"* — but it does not check `app.isPackaged`,
   and in an `electron-vite dev` run `app.getAppPath()` is `apps/desktop`, so
   candidate #3 (`<appPath>/resources/build-info.json`) hits.
4. `config.ts:23` took `getBakedBackendUrl() ?? 'http://127.0.0.1:4000'` as its
   default. A baked value wins in dev.

Every step is individually reasonable. The defect is only visible where they meet.

---

## Evidence — runtime, not inference

Container with PostgreSQL 16 + Redis 7 + the backend live on `:4000`
(`/health` → `{"status":"ok","components":{"database":"up","redis":"up"}}`),
Electron launched headless against the built main process, using the CI-origin
`build-info.json` described above.

| Condition | `Starting in development mode { backendUrl: … }` |
|---|---|
| baked URL present, no env var — **before fix** | `https://api.neuropause033.com` |
| `NEUROPAUSE_BACKEND_URL=http://127.0.0.1:4000` | `http://127.0.0.1:4000` |
| `build-info.json` removed, no env var | `http://127.0.0.1:4000` |
| baked URL present, no env var — **after fix** | `http://127.0.0.1:4000` |
| operator's macOS tree (`backendUrl: null`), before fix | `http://127.0.0.1:4000` |

Row 5 is the operator's machine and is why the severity above is *latent*. Rows 2
and 3 are the workarounds available without a code change. Row 4 is the fix.

---

## Fix

`config.ts` — a packaged build uses the baked URL (that is what baking is for); an
unpackaged run defaults to local. `NEUROPAUSE_BACKEND_URL` still overrides in both
modes, which stays the supported way to point a dev run at staging.

`config.test.ts` — 6 tests. Negative control: reverting the `app.isPackaged` guard
makes case 1 fail with `expected 'https://api.neuropause033.com' to be
'http://127.0.0.1:4000'`; restoring it returns 6/6. Confirmed on the operator's
machine 13 Aug, 6/6 passing.

---

## Rule this adds

A configuration value that depends on filesystem state cannot be certified by
reading the code that computes it, **and cannot be certified against a copy of the
tree.** It has to be printed by a running process on the machine in question.

The Round 17 runtime-evidence discipline was applied to features. It was not
applied to configuration, and it was not applied to the question *whose machine*.

---

## Related, unresolved

- F-4 (the sign-in wall) is unchanged. F-6 explains one way a local backend can be
  running and the app *still* fail to reach it — it was never asked.
- `neuropause033.com` still has no A record; `api.neuropause033.com` is
  134.199.250.188.
- The release workflows bake the production URL by design. Anyone running
  `package:win` / `package:mac` locally arms this on their own machine; after the
  fix, dev runs are immune regardless.
