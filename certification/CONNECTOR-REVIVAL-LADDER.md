# CONNECTOR REVIVAL LADDER — write-deep, ranked (NP-010 §4)
### Presented for the OPERATOR'S ruling, 2026-08-20. Each rung = its own S23 kit run with its own evidence. Nothing below the certified line executes; UNSUPPORTED/UNCERTIFIED refusals stay live at the boundary.

> Preamble (standing): The intelligence proposes. The governance decides. The execution layer acts. The independent
> verifier proves. The Action Record remembers.

**The certified line today:** M365 `mail.send` — the only capability above it (S23 kit-complete, LIVE-VERIFIED
once). Scoring per the master directive §27: user value · frequency · risk · reversibility · verifiability
(oracle availability for honest read-back) · authority complexity · implementation cost · testability.

| Rung | Capability | Oracle for independent read-back | Effort | Risk | Business value | Notes |
|---|---|---|---|---|---|---|
| **2 (presumed)** | **M365 `calendar.create`** | Graph GET event by id (named in the honest needs-registry) | Low | Low (own calendar; reversible by delete) | Medium | Kit DRY-RUN COMPLETE (NP-002): proposal-side proven, production predicate refuses, five S4.2 attack classes hold. The shortest path to capability #2 |
| 3 | M365 `mail.reply` / `mail.forward` | Sent Items corroboration — the S16 oracle generalizes directly | Low-med | Same class as send (outbound mail; allowlist + latch discipline applies) | High — completes the mail loop the §5 overdue-reminder class rides | Reply threads carry quoted content → injection-surface analysis in the kit run |
| 4 | M365 `contacts.create` | GET contact by id | Low | Low (reversible) | Low-med | Cleanest small rung; useful abstraction test before non-mail families |
| 5 | M365 `drive.upload` | GET item by id + content-hash corroboration (STRONG oracle) | Med | Med (outbound file — exfil surface; scope `Files.ReadWrite.All` is broad, F-MR-8) | Med | Kit run must bound path + size + type |
| 6 | M365 `teams.sendChannelMessage` | GET message by id | Med | Med (audience wider than self) | Med | Recipient-substitution attacks are the kit focus |
| **Future (§3-linked)** | **Razorpay `paymentLink.create`** (backend) | Razorpay GET of the created link — a REAL API oracle exists | Med | High (money-adjacent; new consequential class) | **Highest** | Backend gateway already real + fail-closed; needs its OWN kit + keys/consent at the operator's keyboard; first non-M365 rung = the §28/§50 SECOND-CONNECTOR ABSTRACTION TEST |
| Below the line | The 70 infrastructure write actions | Varies per platform | — | High | Not business-first | Stay refused; not candidates until the business tiers are served |

**Standing rules for every rung:** the S5.1 predicate keeps refusing until that rung's kit is complete AND the
operator certifies it (kit-complete ≠ certified); one capability per run; the connector never inherits
certification from a sibling capability (§49); if a rung requires M365-specific branching in the kernel, STOP —
that is the §50 architectural-defect signal, not something to patch around.

**Status: AWAITING THE OPERATOR'S ORDER RULING.** No rung is entered until chosen.
