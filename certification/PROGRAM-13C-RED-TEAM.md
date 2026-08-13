# PROGRAM 13C — RED TEAM

## Status: NOT RUN

The fresh running-application red team specified in Phase 16 was **not
performed**. It requires the packaged application, running, with three tenants
provisioned and an operator driving hostile input across IPC, runtime, queues,
background workers, backup and restore. This certification executed in a Linux
container that cannot launch the Electron application.

Recording it as NOT TESTED rather than partially credited is the point. A red
team that did not happen produces no findings, and "no findings" from an exercise
that was never run is the most dangerous line a security document can contain.

## What the standing evidence does and does not cover

The desktop suite contains a substantial adversarial corpus, executed this run
and green: `crossTenant.test.ts` (52), the `round10`–`round17` tenancy series,
`administrationIdor.test.ts`, `marketplaceOwnership.test.ts`,
`backgroundFanOut.test.ts`, `resolverAttachment.test.ts`, and the tenancy `e2e`
directory. These exercise IDOR by direct id, indistinguishable miss-vs-foreign
responses, unowned legacy rows, unbound-store denial, tenant switch, principal
attachment and background fan-out.

They run **in-process against real stores**. They are not an attack on a running
process, and they cannot cover:

- IPC replay against a live bridge
- stale tenant context held across a real window lifecycle
- active-workspace manipulation through the real renderer
- background principal hijack while jobs are genuinely in flight
- queue principal substitution during a real drain
- runtime enumeration and termination of live processes
- backup tampering against a real archive — which cannot be attacked at all,
  because no production path creates one (see Gate 10 FAIL)

## Findings from this certification run

Not from a red team — from a census. Recorded here so the count is not read as
zero:

| ID | Severity | Finding |
|---|---|---|
| **F-1** | **HIGH** | F22 tenant archive registry ships empty; `registerTenantDomainSource` has zero production call sites; production coverage was 0/19 while reports said 6/19. Tenant backup/restore is not wired into the product. **Fixed** (registration + gate); the end-to-end feature still does not exist. |
| **F-2** | **MEDIUM** | Channel→store coverage is 2/194 (1.0%), not "PARTIAL — 2 declarations". 192 authority-gated channels are invisible to the correspondence rules. **Gated, not closed.** |
| **F-3** | **MEDIUM** | `apps/backend` is inside the security boundary (organizations, auth) and has never been examined by this programme. **Scope determined; not certified.** |
| **D-9** | **LOW** | The performance budget is absolute wall-clock calibrated on one machine and enforced by no CI. Passes on the reference Mac (18.6ms), fails on slower hardware (128.1ms) against a 100ms budget. |

```
CRITICAL  0   (no exercise run that could have produced one)
HIGH      1   (F-1 — fixed at the registry; the missing feature remains)
MEDIUM    2   (F-2 gated, F-3 scoped)
LOW       1   (D-9 documented)
```

The required final state is CRITICAL = 0 and HIGH = 0 **from a completed red
team**. No red team was completed, so that criterion is unmet regardless of the
counts above.
