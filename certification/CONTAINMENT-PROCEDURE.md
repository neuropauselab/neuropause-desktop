# CONTAINMENT PROCEDURE — after a real external effect
### Written 20 Aug 2026 · **PREDICTIVE, NOT VALIDATED** · sourced from CLAUDE §1, not from a performed run

> **WHY THIS FILE EXISTS.** F-P27 established that the ceremony's own procedure existed in no file. The
> reciprocal sweep found three referenced-but-missing procedures; **two of the three had already bitten us** —
> the ceremony's nine steps (F-P27) and the launch sequence's unverified "quit old app instances" (F-P13).
> **Containment is the third, and it is the one that runs the same night as a real send, from memory, with live
> credentials and a live tenant.** Writing it before it is needed is the point.
>
> **PROVENANCE, stated plainly:** every step below is sourced from CLAUDE §1's own words — *"containment
> (operator revokes consent + deletes app registration + the S15 profile — evidence already copied out)"*. **No
> step here has ever been performed.** Where a detail is not sourceable it says **UNKNOWN** and names what would
> establish it. **No step was invented to make the procedure look complete.**

---

## 0 · PRECONDITIONS

| # | Precondition | Verify |
|---|---|---|
| 0.1 | **Evidence is already copied OUT of the profile** | manifest exists and its sha256 is recorded; **preserve first, contain second** — containment is destructive by design |
| 0.2 | **No app instance is running** | `ps -axww -o pid=,command= \| grep '[E]lectron.*--user-data-dir=.*NeuroPause' \| grep -v -- '--type=' \| wc -l` **MUST be exactly 0** (F-P29's corrected predicate; expect a delayed exit per F-P30 and re-check on a 60s cadence to ~10 min — **do not escalate to SIGKILL without an operator ruling**) |
| 0.3 | **The operator is at the keyboard** | every step below is OPERATOR-ACTION; Claude supplies no credential, consent, or confirmation |

## 1 · REVOKE CONSENT — *OPERATOR-ACTION*

Revoke the application's delegated consent in the Microsoft tenant.

- **Exact portal path: UNKNOWN.** Sourced only as "operator revokes consent". **What would establish it:** one
  performed run, recorded verbatim — or the tenant admin's own documented path.
- **VERIFIED BY:** the app no longer appears under the account's consented applications. **The check itself is
  UNKNOWN in exact form** and must be recorded on first performance.

> **Why revoke before delete:** a deleted registration cannot be inspected to confirm what it had been granted.
> Revocation first preserves the ability to verify. *(Reasoning, not a sourced instruction — flagged as such.)*

## 2 · DELETE THE APP REGISTRATION — *OPERATOR-ACTION*

Delete the Entra app registration created for the ceremony.

- **Exact path: UNKNOWN.** Sourced only as "deletes app registration".
- **VERIFIED BY:** the registration is absent from the tenant's app registrations list, **including the
  recently-deleted view** if the tenant retains one. **Retention behaviour: UNKNOWN.**
- **NOTE (sourced, F-1/F-N16-5):** the manifest requested **22** scopes and the tenant granted **21**. Deleting
  the registration is what actually ends that grant's reach — revocation alone may not.

## 3 · REMOVE THE PROFILE — *OPERATOR-ACTION, IRREVERSIBLE*

Delete the ceremony user-data directory (S15's; and any `NeuroPause-S54-*` profile being contained).

- **BEFORE:** re-confirm 0.1. The profile holds `first-real-send.latch`, `action-records.json`, `connectors.json`
  (credential-scrubbed but **PII-preserving** — F-P26), `logs/app.log`, and the assistant conversation store whose
  stored `mailIntent` objects contain **recipient addresses verbatim**.
- **VERIFIED BY:** the directory is absent, and the preserved manifest still verifies against the copy held
  outside it.
- **F-P28 APPLIES TO WHAT YOU KEEP:** the evidence packs are **OPERATOR-PRIVATE**. Containment removes the live
  profile; it does **not** declassify the copies.

## 4 · WHAT CONTAINMENT DOES NOT DO — *the honest boundary*

- **It does not un-send.** The S15 message exists in the destination mailbox. Containment ends future reach; it
  does not reach backwards.
- **It does not invalidate already-issued tokens by itself.** Whether revocation immediately kills a live access
  token, or only prevents refresh, is **UNKNOWN** for this tenant configuration. **What would establish it:** an
  observed attempt after revocation — which is itself an external action and needs its own ruling.
- **It does not remove the ActionRecord or the audit trail**, and must not. Evidence survives containment.

## 5 · AFTERWARDS

Record the run: what was performed, what each verification actually showed, and **every step that was UNKNOWN
above, now filled in from what was observed.** On its first performance this file stops being predictive.

**RECORD SUPERSEDES RECOLLECTION** — that is the whole reason this file exists rather than living in a transcript.
