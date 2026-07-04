# Product Readiness Audit — First Paying Customer

Lens: a stranger with a credit card, not an engineer. Ignores internal
architecture (which is sound: 532 desktop + 168 backend tests, live backend).
Evaluates the *conversion funnel* and ranks every issue by impact on turning a
visitor into a paying customer. Evidence from the renderer + docs recon.

## The funnel, as a stranger experiences it

Discover → **Download** → **First run** → **First value** → **Upgrade/Pay**.
Each stage below is graded and the drop-off risk noted.

## Ranked issues (highest conversion impact first)

### P0 — kills conversion outright

**C1. No download page — the funnel has no entrance.**
Recon: no landing/marketing/download page exists (`docs/` has none); the only
way to get the app is the GitHub **Releases** page of a **private** repo, which a
prospect cannot even see. A paying customer literally cannot obtain the product.
*Impact: total. Nothing else matters until someone can download.*
Fix scope: a public download page (even a single static HTML page linking the
macOS `.dmg` + Windows `.exe`), and Releases reachable (public repo, or a public
distribution mirror). **Highest impact by far.**

**C2. No in-app upgrade path for a customer.**
Recon: the only billing UI is `developer/BillingPanel.tsx` — and it is
**developer/seller-facing** (payouts, revenue, plan-tier gateway rates, seat
assignment). There is **no customer-facing "Upgrade to Pro" surface**: a signed-in
user who wants to pay has nowhere to click. The backend billing is live and
tested, but the *buyer* can't reach it.
*Impact: you cannot take money in-product. Direct revenue blocker.*

### P1 — severe drag on conversion

**C3. Time-to-value is gated behind setup, not delivered.**
Recon: first-run wizard steps are welcome → **set up organization** → **connect a
source** → **set up AI engine (Ollama)** → pilot. That's four setup chores before
any payoff. A new user must create an org, complete an OAuth connect, and
optionally install Ollama before they see a single useful output. The "aha"
(Founder AI answer, a populated Timeline, a Mission Brief) sits *after* the
friction, not woven into it.
*Impact: high drop-off in the first 5 minutes — the make-or-break window.*
Better: deliver one visible win *inside* onboarding (a sample Mission Brief, or a
Founder AI answer on a seeded example) so value precedes the chores.

**C4. Founder AI & Mission Brief are buried and unlabeled as the headline value.**
Recon: Founder AI lives in the **AI Workforce** section (`ExecutiveChatPanel`,
phase-6, sidebar item "AI Workforce"); Mission Brief is `BriefingsPanel` under
**Enterprise**. The two features most likely to sell the product are behind
generic section names a new user won't associate with "my daily brief" or "ask my
company anything." The Welcome view doesn't point at either.
*Impact: the value proposition is undiscoverable — users churn before finding it.*

**C5. Connector setup friction — real-world OAuth reality.**
Recon (from LAUNCH-03): Google Calendar connects today, but GitHub/Notion/Slack
need their OAuth consoles registered, and the connectors require the operator to
supply client IDs. For a *customer*, only connectors you've pre-registered will
work; the rest silently offer nothing.
*Impact: "connect your tools" is a core promise; a customer hitting a dead
connector loses trust. Medium-high.*

### P2 — matters, but after the above

**C6. No customer-facing documentation / getting-started.**
Recon: docs are all internal (audit, launch runbooks, Windows CI). There is no
user-facing "how do I use NeuroPause" guide. Support is the in-app bundle export
(good for you, invisible as a support *channel* to a customer).
*Impact: raises support load and early churn; not a hard blocker.*

**C7. Unsigned installers on both platforms.**
macOS right-click-Open and Windows SmartScreen "Run anyway" are friction at the
worst moment (first launch). Acceptable for known early access; a paper cut for
cold paying customers.
*Impact: first-impression friction; real but not fatal.*

## The verdict

The product **works**; the **funnel does not exist**. In conversion terms, the
two P0s are the wall: **a customer cannot download (C1) and cannot pay (C2).**
Everything else (time-to-value, discoverability, connectors, docs, signing) is
optimization that only matters once those two are open.

## Recommended build order (highest-impact first, one increment each)

1. **C1 — download page** (a real, shareable entrance to the funnel).
2. **C2 — in-app "Upgrade to Pro"** customer billing surface (take money).
3. **C3/C4 — a value-first Welcome** that surfaces Founder AI + Mission Brief and
   delivers one win during onboarding.
4. C5 connectors, C6 docs, C7 signing.

## What to build now

Per the directive ("build only the highest-impact customer-facing improvement,
stop after each increment"), the next increment is **C1: the download page** —
it is the single change without which zero conversions are possible. It is also
customer-facing, self-contained, and verifiable. Proposed: a polished static
landing/download page (HTML, brand-aligned) with macOS + Windows download links
wired to the GitHub Release assets, plus the honest note that Releases must be
reachable (public repo/mirror) for the links to resolve.

**STOP — awaiting approval to build C1 (or your redirect to a different item).**
