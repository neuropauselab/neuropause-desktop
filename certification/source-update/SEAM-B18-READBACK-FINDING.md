# SEAM-B.18 — CONTACTS READ-BACK / DOCUMENTATION-PARITY FINDING

**Recorded, deliberately NOT fixed (B.18 §43/§44). No source touched by this finding.**

## The two divergences (measured in B.17 against current Microsoft Learn, 24 Aug 2026)

**1 · `contacts.search` uses an undocumented query shape.**
The adapter issues `GET /me/contacts` with `$search="…"` (`connectors/m365/contacts.ts`). The v1.0
reference for *List contacts* documents **only** `$filter` on `emailAddresses/any(a:a/address eq '…')`
and states filtering is limited to that sub-property; `$search` is not documented for this resource.
Source: learn.microsoft.com/en-us/graph/api/user-list-contacts.
**Not asserted to fail** — undocumented is not the same as unsupported, and no live call has been made.

**2 · The contacts delta path differs from the documented shape.**
The sync path uses `GET /me/contacts/delta`; the v1.0 *contact: delta* reference documents the
**folder-scoped** `GET /me/contactFolders/{id}/contacts/delta`.
Source: learn.microsoft.com/en-us/graph/api/contact-delta.
**Left unchanged** — the sync implementation depends on the current path, and B.18's envelope is the
authentication surface, not the read path.

## Consequence for the (still unexecuted) B.17 ceremony
PRIMARY read-back candidate: **`contacts.detectDuplicates`** — it issues the documented
`GET /me/contacts?$select=id,displayName,givenName,surname,emailAddresses&$top=200` shape and returns
ids, so it can confirm the created object by marker without relying on `$search`.
`contacts.search` and the delta path are **BEST-EFFORT / corroborating only** until validated live.

## Status
`READBACK_PARITY: FINDING_OPEN` — a separate read-back-parity gate would be needed to validate or
correct either shape. Neither is a blocker for the scope-minimization work, and neither was repaired
here (no unrelated source repair inside an implementation gate).
