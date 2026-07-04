# V2.5 — Executive Intelligence Center UI

The visual Executive Intelligence Center: a presentation panel over the V2.4
composition snapshot. No new intelligence, no new dashboard framework, no new
navigation system — it reuses the existing IPC bridge, the Enterprise tab shell,
the `OpsPanel` primitive, and the existing tone/color system.

## STEP 1 recon — reused, never duplicated
- `IpcChannel.ExecutiveCenterSnapshot` (V2.4) → the data, via a new one-line
  binding on the existing `ipc` namespace (`ipc.intelligence.executiveCenterSnapshot`).
- `OpsPanel` primitive → the panel chrome (title/subtitle/body), same as every ops panel.
- `TINT_TONE` / `TEXT_TONE` / `DOT_BG` / `OpsTone` (operations/lib) → the color
  system; the panel introduces NO new palette.
- `Icon`, `EmptyState`, `Spinner`, `cn`, `formatRelative` → existing UI atoms/helpers.
- The **Enterprise tab framework** → the panel mounts as a new "Executive" tab
  beside Command Center / Briefings; no new sidebar section or SectionId.
- `useShell().setSection` → deep-link navigation into existing modules.

## Architecture
```
ExecutiveCenterPanel (renderer)
   useEffect → ipc.intelligence.executiveCenterSnapshot()   [on-demand, no polling]
        │  ExecutiveCenterSnapshot (V2.4)
        ▼
   KPI strip  (6 tiles, each deep-links via setSection(deepLinkToSection(link)))
   + 5 section cards (Critical Alerts, Founder Recs, Org Health, Engineering,
     Upcoming) — each shows top-4 governance-bearing items + an "Open" deep-link
        │
   deepLinkToSection()  ← PURE mapper (deepLink → SectionId), unit-tested
```

## Navigation (STEP 3) — no duplicated detail pages
`executiveCenterNav.ts` maps the composition layer's path-like deepLinks to the
existing renderer `SectionId`:
- `enterprise/organization` → organization · `enterprise/*` → enterprise
- `ai-workforce/*` → workforce · `connectors` → connectors
- `notifications`/`memory`/`settings`/`analytics` → same · unknown → home (safe).
Every KPI tile and every card "Open" button routes through this into the real
module — the Center never renders its own detail view.

## Visual design (STEP 4)
Matches the app's existing glassmorphic dark aesthetic (Apple-HIG direction from
the product vision): the KPI strip is the "instrument cluster" (the one bold
element — tabular numbers, band-colored tint, health dot), and the cards stay
quiet and scannable (priority dot, title, 2-line body, confidence + source
footnote). Responsive grid (2→3→6 KPI columns; 1→2 card columns). Keyboard focus
rings on every interactive element; truncation/line-clamp prevent overflow.

## Performance (STEP 5)
- On-demand fetch in `useEffect` with an `alive` guard — **no polling**.
- Cards render only the top 4 items (+"N more" deep-link) — bounded DOM.
- Reuses existing stores via the snapshot; adds no new renderer state store.
- The tab is lazy by virtue of the existing Enterprise view's lazy mount.

## Files changed
- `apps/desktop/src/renderer/src/lib/ipc.ts` — one binding +
  `ExecutiveCenterSnapshot` type import.
- `apps/desktop/src/renderer/src/enterprise/executiveCenterNav.ts` (new) — pure
  deepLink→SectionId mapper.
- `apps/desktop/src/renderer/src/enterprise/executiveCenterNav.test.ts` (new) — tests.
- `apps/desktop/src/renderer/src/enterprise/ExecutiveCenterPanel.tsx` (new) — the panel.
- `apps/desktop/src/renderer/src/enterprise/lib.ts` — `'executive'` added to `EnterpriseTab`.
- `apps/desktop/src/renderer/src/enterprise/EnterpriseView.tsx` — tab def + import + render line.

## Tests & verification
- **Desktop typecheck: 0 errors** — this is the primary gate for renderer TSX
  (types cover the IPC contract, the snapshot shape, the tone system, and the
  exhaustive SectionId mapping). Backend typecheck: 0. Lint: clean.
- **Main test suite: 567 passing** (unchanged — no regressions).
- `executiveCenterNav.test.ts` is written and typechecks clean. **Honest caveat:**
  the repo's vitest config scopes the runner to `src/main/**`, so renderer tests
  aren't executed by the standard `vitest run`. The mapper's correctness is
  additionally guaranteed by TypeScript's exhaustive `SectionId` return type. If
  renderer tests are enabled later (add `src/renderer/**` to the vitest include),
  this test runs as-is.

## Known limitations — read honestly
- **The visual result is not verified in this environment** (no headless browser
  in CI, same constraint as the website). The panel typechecks, lints, and follows
  the exact existing panel conventions, but the pixel-level appearance is a
  **manual check on macOS**: build the app, open Enterprise → Executive.
- Five of the STEP 2 sections are implemented (Today's summary via KPIs + counts,
  Critical Alerts, Founder Recs, Org Health, Engineering, Upcoming). The fuller
  list (Executive Timeline, Weekly Trends, Recent Decisions, Recent Deliveries,
  Evidence Summary) depends on V2.4 adding those cards to the snapshot first —
  each is a composer addition, then a card here.
- No Framer Motion animation added yet; the vision lists it for polish. Entrance
  motion is a follow-up (kept out to stay minimal and avoid the AI-generated feel).
- Snapshot is fetched once per mount; a manual "refresh" affordance and/or a
  cached snapshot are future refinements.

## How to see it
Build the desktop app and open **Enterprise → Executive**. The KPI strip and cards
populate from live intelligence; click any tile or "Open" to jump into the owning
module.
