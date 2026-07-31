# NEMS Workspace Assistant — User Guide (Phase 6 Stage 4)

One conversation for enterprise work: ask about anything in your workspace, have deep analysis prepared, build inspectable plans, and run real work — with every action stopping for your explicit approval, and every answer showing exactly how it was produced.

## Getting there

- **Sidebar → Assistant** (right under Search).
- **⌘K** — type anything, choose **"Ask Assistant: …"**.
- **Mission Control** — type in the search box and pick **"Ask Assistant: …"** from the dropdown.

## The five modes (one assistant, five gears)

- **Ask** — quick grounded answers. No actions are ever offered.
- **Analyze** — deeper retrieval and reasoning for "explain why…" questions.
- **Plan** — builds the full plan for an action request but runs **nothing**, not even after you approve a step (a dry-run you can inspect).
- **Execute** — the acting mode: read steps run, and every side-effecting step stops at an approval card first.
- **Monitor** — a deterministic operational snapshot (executions, approvals, connector problems, automations). No AI narrative at all, by design.

## What you can say

*Summarize today's work* · *Find every invoice overdue by 30 days* (hands off to Universal Search) · *Explain why sales dropped* · *Draft a customer response* (a review-only draft — the assistant never sends anything) · *Prepare tomorrow's meeting* (drafts an agenda from your data) · *Launch the onboarding automation* (finds the rule by name, shows the approval card) · *Show connector problems* · *Open Mission Control*.

If the assistant isn't sure what you mean, it says so and asks — it never guesses. If you paste something that looks like a password, API key, card number, or medical detail, it refuses to process or store it and tells you why.

## Approvals — nothing runs on its own

A step that would change anything shows a card first: **What** will happen, **Why** the assistant chose it, the **Impact** and risk, and — honestly — whether any rollback exists (usually: *"No automatic rollback — review the target before approving."*). **Approve & run** dispatches it through the same execution engine and governance every other surface uses; **Reject** cancels it. After it runs, the step shows a **Verified:** line read from the real execution session — never assumed. AI-worker steps can add a second checkpoint of their own in the workforce Approval Center; the assistant tells you when that happens.

## Reading a response

Verified findings (green, read directly from your data) are separate from the AI narrative, and both are separate from advisory recommendations. Below every reply a strip shows sources · tool calls · confidence (or **"AI offline — deterministic"** when no model is configured — the facts still answer). Unavailable systems and assumptions are listed explicitly, e.g. *"Unavailable — timeline: not initialized"* or *"'me' is not yet resolved to your account."*

## The Session Inspector

Click **Inspect** on any reply. Three views over the same record:

- **User** — what informed the answer and what ran.
- **Developer** — plus every retrieved item, the exact prompt id + version, model, latency, tokens and cost, and per-phase timings.
- **Administrator** — plus the audit joins: the permission class used, the AI audit record id, execution session ids, and the timeline events — all sharing the turn's **Correlation ID** (`asst_…`), so one id traces the whole turn end to end.

## Conversations

Everything persists per conversation: pick past ones from the rail, **Pin** the important ones, **Delete** what you don't need (audited), and **Branch from here** on any reply to explore an alternative without losing the original. **Stop** interrupts a running turn honestly — it lands as "stopped", not as a fake answer. Decisions and preferences you state are remembered through the same governed executive memory the Founder AI uses (secrets always refused).

## Honesty notes

The assistant only ever acts through the platform's existing, gated execution paths — approving is the only way anything runs, and Plan mode never runs anything at all. Drafts are never sent. With no AI provider configured, every mode still works on deterministic data alone. "Assigned to me" style personal filters aren't resolved to your account yet (coming with a later stage), and workflow launching currently targets your saved automations by name — if nothing matches, the assistant says so instead of picking one for you.
