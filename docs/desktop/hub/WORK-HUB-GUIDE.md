# Work Hub — User Guide (Phase 6 · Stage 5)

The Work Hub is the personal-workday surface: one place for your brief, meetings, tasks, emails, approvals, notifications, and the executive picture. It sits in the sidebar right after the Assistant.

**Positioning.** Mission Control is the organizational operations landing. Today's Intent shows strategy outcomes. The Work Hub is *your day* — what's on your plate, what needs you, and what happened.

Everything in the Hub is composed from systems that already exist — the briefing generator, the recommendation engine, the notification inbox, the AI workforce, the assistant, your synced work data (UDM), the ExecuteEngine history, and the executive snapshot. The Hub adds no new engine and no new execution path.

## Tabs

### Today

| Tile | What it shows | Where it comes from |
| --- | --- | --- |
| Today's brief | The period-appropriate brief (morning / afternoon / evening) | The existing briefing generator — the same facts your delivered brief contains |
| Meetings today | Today's remaining calendar events, with a **Prepare** action | Synced calendar entities; Prepare hands off to the Assistant's meeting-prep flow |
| Priorities & recommendations | Evidence-backed next actions with **Why / Action / Systems / Confidence** on every card | The recommendation engine (including the Stage 5 rules: open approvals, connector issues, automation opportunities, follow-ups, unanswered email) |
| Notifications | The most recent delivered notifications, unread first | The notification inbox (see the Notifications guide) |
| Productivity timeline | A chronological view of your day — conversations, executions, approvals, notifications, and delivered briefings | A pure composition of existing records; nothing new runs to build it |

### My Work

| Tile | What it shows |
| --- | --- |
| Tasks | Assistant tasks and connected-system tasks **side by side, never conflated** — each row labeled with its source |
| Emails | Deterministically prioritized messages (unread → recency → sender frequency), each with the reason it ranked there. The Hub never sends email. |
| Approvals waiting | Workforce proposals parked for your decision, with a jump to the Approval Center |
| Assistant conversations | Recent conversations, flagged when plan steps are still waiting on you |
| Work summary (today) | A **descriptive** aggregation of the day — completed work, meetings, AI assistance, what's still open, risks. It is not a score and never will be. |

### Executive

The executive tab composes the existing executive snapshot (org health, workforce, approvals with oldest-pending age, risk, activity, operations) with the top recommendations and recent decisions. Zero new analytics — the same numbers the Enterprise dashboard computes.

## Honesty contract

Every tile loads independently. If a feed fails, that tile shows an explicit *Unavailable — reason* and every other tile keeps working. Empty feeds render honest empty states ("No more meetings today", "You're all caught up"). Nothing is fabricated, and no number is invented.

## Working with tasks

Tasks are created conversationally through the Assistant ("add a task to send the Q3 deck tomorrow", "remind me in 2 hours to call Sam", "mark the deck task done", "show my open tasks"). They are stored in the workspace memory store (kind `task`), screened by the same governance as everything else, and audited with the turn's correlation id. Delegating a task to an AI worker always parks as an approval step — nothing dispatches without you.
