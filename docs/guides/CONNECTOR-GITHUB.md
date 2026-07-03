# Connecting GitHub (live data)

This guide turns the GitHub connector from "built but dormant" into a live
integration that syncs your real repositories, issues, pull requests, and
notifications into NeuroPause.

The connector code is fully implemented. To go live you only need to:

1. Register a GitHub **OAuth App** (one time, ~3 minutes).
2. Supply its Client ID and Client Secret to the app as two environment variables.
3. Click **Connect** and authorize in your browser.

There is no LLM involved here. This is a real data integration: NeuroPause reads
your GitHub data over the official API and files it into the unified store,
knowledge graph, and memory. It only ever **reads** — it never writes to GitHub.

---

## Prerequisites

- The fixed-loopback-port change must be applied (delivered alongside this guide).
  GitHub OAuth Apps require an exact, registered callback **port**, so NeuroPause
  pins the GitHub redirect to `http://127.0.0.1:42813/callback`. The other
  connectors keep using an OS-assigned random port; only GitHub is pinned.

---

## Step 1 — Register a GitHub OAuth App

1. Sign in to GitHub in your browser.
2. Go to **Settings -> Developer settings -> OAuth Apps**
   (direct link: https://github.com/settings/developers).
3. Click **New OAuth App**.
4. Fill in the form:
   - **Application name:** anything, e.g. `NeuroPause Desktop (local)`
   - **Homepage URL:** `http://127.0.0.1:42813`
   - **Authorization callback URL:** `http://127.0.0.1:42813/callback`
     - This must match **exactly** — same host, same port, same path.
       This is the single most important field.
   - Leave "Enable Device Flow" unchecked.
5. Click **Register application**.
6. On the app page, copy the **Client ID** (looks like `Iv1.xxxxxxxxxxxxxxxx` or a
   20-character string).
7. Click **Generate a new client secret**, then copy the secret immediately.
   GitHub shows it **only once** — if you lose it, generate another.

### About the permissions you are granting

When you authorize, GitHub's consent screen will list these scopes (requested by
the connector manifest):

- `read:user` — read your profile.
- `repo` — read repository metadata and issues. Note: `repo` is GitHub's
  broad repository scope (it technically also covers write), because GitHub has no
  finer-grained "read private repos" OAuth scope. **NeuroPause only reads.** If you
  prefer to limit exposure, connect an account that only has access to repos you're
  comfortable sharing, or use an organization with read-restricted membership.
- `notifications` — read your notifications.

---

## Step 2 — Give NeuroPause the credentials

The app reads two environment variables in its main process. They are never sent
to the renderer, never logged, and never committed.

Create a local secrets file at the repo root (it is already git-ignored via the
`.env.*` rule, so it will not be committed):

```
cat > .env.github << 'EOF'
export NEUROPAUSE_GITHUB_CLIENT_ID="paste-your-client-id"
export NEUROPAUSE_GITHUB_CLIENT_SECRET="paste-your-client-secret"
EOF
```

Replace the two placeholder values with what you copied in Step 1.

> Security: keep this file local. Anyone with the Client Secret can act as your
> OAuth App. If it ever leaks, click **Generate a new client secret** on the
> GitHub app page to invalidate the old one.

---

## Step 3 — Run the app with the credentials loaded, then connect

From the repo root, load the variables into your shell and start the app in the
same command (so the running app inherits them):

```
source .env.github && npm run dev
```

Then, in NeuroPause:

1. Open **Connectors**.
2. Find **GitHub**. With the variables set, it should show as available
   (no "set NEUROPAUSE_GITHUB_CLIENT_ID..." hint).
3. Click **Connect**.
4. Your system browser opens GitHub's authorization page. Review the scopes and
   click **Authorize**.
5. The browser redirects to a local "You are signed in" page. Close that tab and
   return to NeuroPause.
6. The account now appears under GitHub, and the first sync runs automatically.

---

## What syncs, and where it shows up

The GitHub sync adapter pulls three resources over `https://api.github.com`:

| Resource        | GitHub endpoint        | Filed as        |
| --------------- | ---------------------- | --------------- |
| Repositories    | `/user/repos`          | projects        |
| Issues & PRs    | `/issues`              | tasks           |
| Notifications   | `/notifications`       | notifications   |

Once synced, this data is queryable through the unified store, surfaces in the
knowledge graph and AI memory, and is searchable in enterprise search. The AI
Workforce's deterministic skills can then reason over it (e.g. summarizing open
work) — all on-device, no model calls.

---

## Troubleshooting

**"The redirect_uri MUST match the registered callback URL"** (shown by GitHub
after you click Authorize)
- The callback URL on your OAuth App is not exactly `http://127.0.0.1:42813/callback`.
  Re-open the app under Developer settings and fix it. Watch for `https` vs `http`,
  a trailing slash, or a different port.

**GitHub still shows as unavailable / "set NEUROPAUSE_GITHUB_CLIENT_ID..."**
- The variables are not in the environment of the running app. Make sure you ran
  `source .env.github` in the **same** terminal, immediately before `npm run dev`.
  Confirm with: `echo "$NEUROPAUSE_GITHUB_CLIENT_ID"` — it should print your ID.

**"Loopback port 42813 is in use"**
- Another process is using that port. Find and stop it
  (`lsof -nP -iTCP:42813 -sTCP:LISTEN`), then click Connect again.

**Browser opens but nothing happens after authorizing**
- The sign-in has a timeout. If you took too long, just click **Connect** again.

**I want to revoke access**
- In the app, disconnect the GitHub account. You can also revoke at
  GitHub -> Settings -> Applications -> Authorized OAuth Apps.

---

## What gets synced (Increment 2 — active-repo deep sync)

The connector does not try to mirror all of GitHub. It deep-syncs only **active**
repos and, for each, pulls just the entities that move the Executive Mission
Brief — open work and releases.

**A repo is "active" if** (judged from the repo list alone, no extra API calls):

- it was **pushed** within the last 90 days (proxy for recent commits), **or**
- it had any **activity** (`updated_at`) within the last 90 days, **or**
- it has any **open issues or open PRs** (`open_issues_count > 0`).

Archived repos are never active.

**For each active repo it syncs:**

| Source | Becomes | Why it earns its place |
|---|---|---|
| Open issues (`state=open`) | `task` (status `open`) | Engineering health — what's pending. Surfaces in the brief's "Needs attention". |
| Open pull requests (from `/pulls`) | `task` (status `open`/`draft`) | Engineering + team health. `reviewers` count feeds "awaiting review". |
| Recent releases | `activity` | Release health — what shipped, and when. |

Every entity is linked to its repo's `project` (via `containerId`), so the graph
draws "repository contains …".

**Deliberately *not* synced (and why):**

- **Individual commits** — high volume, low decision value. Recency is already
  captured by the repo's `pushed_at`.
- **Closed/merged issues & PRs** — only open work needs attention; closed history
  would bloat the store without improving the brief.
- **Workflow runs / GitHub Actions** as first-class entities, **milestones** — planned
  for a later increment. (CI failures already surface today via notifications.)
- **Cross-repo "assigned to me" issues** in repos that aren't active or that you
  don't own — the previous behavior. Replaced by per-repo coverage of your active
  repos, which is more complete for *your* projects.

**Known limitation — "user-pinned" as an active signal:** GitHub only exposes
pinned repos through its GraphQL API; this connector uses REST. Pinned repos are
still synced if they meet any of the push/activity/open-issue criteria above
(which they almost always do). True pin-awareness is deferred to a GraphQL pass.

**Bounds (safety):** at most 100 active repos per sync (most-recently-pushed
first), and at most 10 pages per repo-resource, so no single repo can exhaust the
5,000 requests/hour budget.

---

## What gets synced (Increment 3 — CI runs + Mission Brief health)

Increment 3 is about a sharper **Executive Mission Brief**, not more raw data. One
new entity type is synced — recent CI runs — purely because the brief's CI-health
signal needs real pass/fail data (notifications only fire on failure, so they
can't yield a success rate).

**New sync (scoped):** for each active repo, the most recent page of **workflow
runs** (`/actions/runs`, ~50 newest) → `activity` entities tagged
`metadata.activityKind = 'ci_run'` with the workflow, branch, and conclusion
(success / failure). CI history is intentionally *not* walked deep — the latest
page is the health signal, at bounded cost. Releases are likewise tagged
`metadata.activityKind = 'release'` so the brief can tell the two apart.

**Four new Mission Brief sections** (computed deterministically, every line cited):

- **Release health** — what shipped recently, newest first; always shows the
  latest release so "last shipped N days ago" is visible even in a quiet window.
- **Pull requests** — open PRs, most-stale first; flagged *awaiting review* when
  reviewers were requested, drafts called out separately.
- **CI health** — recent runs grouped by `repo@branch`, surfacing failing lanes
  as "X/Y recent runs failed", citing the failed runs.
- **Engineering risk** — a prioritized synthesis: PRs awaiting review >3 days, CI
  lanes that are unstable, and open issues stale >14 days.

The headline now also reflects in-window releases, PRs awaiting review, and
failing CI branches.

**Still deferred:** GitHub Actions *per-workflow* trends and milestone/deadline
signals — a later increment.
