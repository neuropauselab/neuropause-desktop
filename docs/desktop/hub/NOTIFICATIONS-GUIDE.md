# Notifications & Delivery Preferences (Phase 6 · Stage 5, D-8)

Stage 5 makes the delivery engine's `notification-center` channel real: every item the Executive Intelligence Delivery engine delivers now also lands in a durable in-app inbox, behind the toolbar bell and the Notifications view.

## What lands in the inbox

**Scheduled intelligence** (unchanged sources, same generator):

- Morning Brief, Evening Summary — as before
- Afternoon Update (new period, default 13:30, adjustable)
- Weekly Brief (your chosen day) and Monthly Executive Summary
- Founder AI proactive findings and Organization Intelligence alerts

**Event-driven notifications** (new sources on the existing engine — each passes the same gates as scheduled intelligence):

| Source | Fires on |
| --- | --- |
| Approvals | A workforce proposal parks for your decision |
| Work complete / failed | Jobs, automations, and workflows finishing or failing |
| Connector issues | Sync failures, offline connectors, re-auth needed |
| Risk signals | Supervisor-critical and infrastructure alerts |
| Meeting reminders | A calendar event starting within 30 minutes |

Delivery gates, in order: notifications enabled → per-source mute → minimum priority → Do Not Disturb (critical always gets through). A repeating condition (a flapping connector, a meeting inside its reminder window) replaces its inbox row instead of flooding, and re-toasts at most once per 30 minutes.

## The inbox

- Durable (survives restart), capped at 200 items, newest first.
- Unread state drives the bell badge; *Mark all read* and per-item read are instant.
- Clicking a notification follows its deep link into the existing section it points at (Approval Center, Connections, Work Hub, …).
- Re-delivery of the same item (e.g. today's brief regenerating) replaces the old row and marks it unread again.

## Preferences

The Notifications view surfaces the *existing* delivery-preference store (nothing was rebuilt):

- Enable/disable, Do Not Disturb, minimum priority
- Morning / afternoon / evening times and the weekly-brief day — changes take effect immediately (sources re-register live; no restart)
- Per-source mutes for every scheduled and event-driven source

Preference writes go through `notifications:prefs.set`, which is validated, audited, and classified under the fail-closed IPC startup invariant like every other channel.

## API surface (documented Stage 5 cluster)

| Channel | Purpose |
| --- | --- |
| `notifications:list` | Page the inbox (items, unread, total) |
| `notifications:markRead` | Mark ids (or `all`) read |
| `notifications:prefs.get` / `notifications:prefs.set` | Read / patch the delivery preference store |
| `notifications:event` (broadcast) | Live refresh signal (`added` / `read`, unread count) |
