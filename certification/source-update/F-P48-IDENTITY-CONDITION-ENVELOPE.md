# F-P48 · GOVERN THE IDENTITY CONDITION — GATE-CLASS ENVELOPE

**STATUS: PRESENTED, NOT APPLIED.** No file modified. `executionGate.ts` only. **FG-16 stays FREE** — this is a
GATE-class presented diff, not a frozen gate.

---

## 1 · THE SHAPE

| identity | proposal | outcome |
|---|---|---|
| **UNRESOLVED** | — | **REFUSE**, `reason: IDENTITY_UNRESOLVED` |
| resolved | present, re-derives clean | **ADMIT** *(unchanged)* |
| resolved | absent | **SKIP** *(unchanged)* |

Per §5.0f: *do not govern the lookup result; govern the identity condition that makes the lookup result
meaningful.* The check goes **before** the lookup because an unresolved identity makes the lookup's answer
uninformative — the key was wrong, so a miss says nothing about the table.

## 2 · THE REASON — `IDENTITY_UNRESOLVED`, AND WHY IT IS NOT IN THE PROPOSAL ENUM

Carried on the **same `reason` field**, **not** added to `proposalExecutionBoundary`'s seven.

**The seven answer WHY WAS THIS PROPOSAL REJECTED. This one answers WHY WAS NO PROPOSAL QUESTION ASKED.**
Different questions do not share an enum, or a non-proposal reason enters a proposal-refusal vocabulary and every
later reader infers a proposal existed. Structurally: all seven are only reachable **after** `takeProposal`
returns a proposal; this one is only reachable **before** it is called.

- **NOT `NO_PROPOSAL`** — false. The legitimate skip also has no proposal; the name would describe both and
  distinguish neither.
- **NOT `NO_TENANT`** — `boundDecisionClaimMint.ts:73`'s reason lives on the **workforce router**, not this path.
  **Semantic adjacency is not sameness.**

**To appear verbatim in the docstring:**
> **THIS REFUSAL IS NOT ABOUT THE PROPOSAL. IT IS ABOUT THE PRECONDITION FOR ASKING ABOUT THE PROPOSAL.**

## 3 · THE DIFF, VERBATIM

```diff
   if (r.actionId !== 'mail.send') return { ok: true }; // only the certified consequential capability is gated
   const tenantId = deps.workspaceId() ?? '';
+  /**
+   * F-P48 — GOVERN THE IDENTITY CONDITION, NOT THE LOOKUP RESULT.
+   *
+   * THIS REFUSAL IS NOT ABOUT THE PROPOSAL. IT IS ABOUT THE PRECONDITION FOR ASKING ABOUT THE PROPOSAL.
+   *
+   * An unresolved workspace makes the proposal key meaningless, so a lookup MISS carries no information: we did
+   * not fail to find a proposal, we were never in a position to look. Previously that miss fell through to SKIP
+   * and the send PROCEEDED — a gate that skips on a key miss is not a gate, it is a lookup with a permissive
+   * default, and the miss happened exactly when identity was least certain.
+   *
+   * `deps.workspaceId()` is TOTAL in production (`runtimeCore.ts:474-478` coalesces twice), so `''` IS the
+   * unresolved signal and the `??` above is untouched. `''` and `null` are treated identically, because AN
+   * EMPTY ID IS AN UNRESOLVED ID WEARING A STRING — the rule `connectorVault.clear()` already learned.
+   *
+   * This is checked BEFORE the lookup deliberately: after it, the two skips are indistinguishable.
+   */
+  if (tenantId === '') {
+    log.warn(`L6-GATE REFUSE capability=${r.actionId} — IDENTITY_UNRESOLVED (no workspace resolved)`);
+    emitGovernance('DENY');
+    return { ok: false, refusal: { ok: false, message: 'L6 execution gate refused', data: { outcome: 'DENIED', reason: 'IDENTITY_UNRESOLVED' } } };
+  }
   // Phase-0 placeholder state hash (stable per tenant → no false drift); the propose seam supplies the real one.
   const stateHash = tenantId;
```

**One hunk, one file.** `emitGovernance` is hoisted above this block (it is currently declared after
`gateL6Execution`); that move is mechanical and carries no behaviour. **The `??` is not touched. `skip` is not
rewritten globally** — the change is local to the identity-miss condition.

## 4 · THE PREMISE, MEASURED

**The legitimate skip path is the PRIMARY send path, not a hypothetical:**
`M365WritePanel.tsx:106` → `ipc.connectors.m365Execute(…, 'mail.send', {to, subject, body}, true, …)` →
`IpcChannel.M365ActionExecute` → `connectors/index.ts:593` → gate at `:606`. It arrives with a **resolved**
workspace and **no proposal**, because the only production `stashProposal` caller is `brainProposeLane.ts:165`.
**A blanket `skip → deny` would break every ordinary human-composed send.** That is why the fix is conditioned on
identity rather than on proposal-absence.

## 5 · THE CONFIRMING READ — **RUN, AND IT PASSES. IT ALSO NEARLY WENT THE OTHER WAY.**

**Question:** can any non-renderer path reach the gate, where an unresolved workspace would be legitimate?

**A first pass concluded "renderer-only" from `ipcMain.handle` alone. That would have been WRONG.**
`runSecureHandler` has **four main-side callers**, and `handlerByChannel` is built explicitly *"so it can resolve
any of them by channel."* Three non-renderer dispatchers hold it:

| Dispatcher | Channels it can reach | `M365ActionExecute`? |
|---|---|---|
| Companion (`bindDispatch`) | `EnterpriseModuleUpdate`, `EnterpriseModuleAction` | **no** |
| API gateway (route table) | 24, all Enterprise / Graph / Automation / Industry | **no** |
| Sandbox platform | 6 × `EnterpriseModule*` | **no** |

**Every dispatcher passes a channel LITERAL, never a caller-supplied value**, and no `special` route forwards an
arbitrary channel. **Conclusion: the gate is renderer-originated only; no background send reaches it.** Neither
`secureBridge` nor `connectors/index.ts` wraps handlers in `runAsPrincipal`/`forEachTenantBackground`, so the
handler never runs under a background principal — `''` therefore means *no active workspace in a renderer call*,
never a legitimate SYSTEM job. **The shape does not change.**

> **THE RESIDUAL, NAMED: this safety rests on CALL-SITE DISCIPLINE, NOT ON A MECHANISM.** `handlerByChannel`
> resolves anything; the day a dispatcher forwards a caller-supplied channel, `M365ActionExecute` becomes
> reachable from a non-renderer context — and **this fix would then refuse it**, which is the safe direction but
> not a designed one. Filed as **F-P54** rather than left in this paragraph, per *a local accommodation is a
> finding that was not filed.*

## 6 · THE UX CONSEQUENCE — RECORDED, NOT SOLVED

The refusal inherits the existing path's opacity: `M365WritePanel` surfaces refusals through the same channel,
and the DEV-gated refusal surface means production shows little. **ON AN UNRESOLVABLE CONDITION, AN OPAQUE
REFUSAL IS A LOOP** — the user is told no, cannot see that the cause is *no workspace resolved*, retries, and is
told no again, with nothing on screen naming the one action that would fix it. **That is F-P50's territory
(the propose refusal's operator-visibility half) and it is NOT fixed here.** Recorded so the fix is not mistaken
for complete: this closes a governance hole and hands F-P50 a second caller.

## 7 · IT INHERITS ROUTE A'S EVIDENCE FOR FREE

`emitGovernance('DENY')` is already built and already pinned: the refuse branch mints an `ActionRecord` with
**governance `DENY` · execution `NOT_STARTED` · verification absent**, keyed by the workspace id, best-effort.
**So F-P48 arrives with durable governance evidence on day one** — the refusal is auditable the moment it exists,
which is exactly what F-P24 asked for and what the old silent skip never had. **Pinned, not assumed** (pin 5).

*Note the ordering that makes this work: the emit uses `tenantId`, which is `''` here — the row is keyed by the
empty workspace. That is honest (it records that identity was unresolved) and is asserted in pin 5 rather than
left to inference.*

## 8 · WHAT IT IS NOT — **NOT DECISION-NEUTRAL, AND THAT IS THE POINT**

**This is the first decision-CHANGING gate slice.** Route A added evidence and changed nothing; this changes what
the product does: a send that previously proceeded now refuses.

**Route A's byte-identical-return baseline is what makes the change measurable.** Because the gate's return was
proven identical for all three outcomes at `55bcfd2`, any difference observed now is attributable to *this* diff
and nothing else. **That is why the two were sequenced apart** — and it is the concrete payoff of the rule that
you cannot prove decision-neutrality in the same commit as a decision change.

## 9 · THE PINS — CONSUMER-DERIVED (§2 #27). DEFINED HERE, NONE WRITTEN.

1. **resolved + proposal → ADMIT**, and the send proceeds.
2. **resolved + no proposal → SKIP, AND THE SEND STILL PROCEEDS.** *The regression guard for the primary send
   path, and the most important pin in the set.* **Derived from the CONSUMER** — the human-composed send path
   that must keep working — **not from the gate's own branch**, because a pin written from the branch would only
   assert that the branch is the branch.
3. **unresolved → REFUSE**, and the send does **not** proceed.
4. the refusal carries **`IDENTITY_UNRESOLVED`**, and **not** any of the seven proposal-boundary reasons.
5. **REFUSE mints the Route A governance row**: `DENY` · `NOT_STARTED` · no verification.
6. **the governance row moves no counter** — all five write states unchanged.
7. **a throwing store does not change the gate's decision** — the refusal stands whether or not the evidence
   lands. *(Evidence is best-effort; refusal is not.)*

## 10 · WHAT IT DOES NOT CLOSE

F-P24's remainder (durability, F-P53) · F-P50 (it adds a caller) · F-P52's queued flush-barrier work ·
F-P39's terminal · `productionWired`. **Nothing here is applied.**
