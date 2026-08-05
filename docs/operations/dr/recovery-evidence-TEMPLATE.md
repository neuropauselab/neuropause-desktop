# Recovery Evidence — TEMPLATE

Copy this file to `recovery-evidence-YYYY-MM-DD-<scenario>.md` and fill every
field **during** a drill or real recovery. Blank fields (`____`) mean "not yet
measured" — never guess or backfill. This record is what converts an RTO/RPO
*objective* into a *measured* value in [`README.md`](./README.md).

> This is a blank form. It contains no results. A filled copy is evidence; this
> template is not.

## Header

- Type: ☐ scheduled drill ☐ real incident
- Scenario (DR-PLAN §): `____`
- Date / time zone: `____`
- Incident Commander: `____`
- Recovery Operator: `____`
- Scribe: `____`
- Related incident ticket / postmortem: `____`

## Objectives vs. measured

| Metric | Objective | Measured | Met? |
|--------|-----------|----------|------|
| RTO (service restored) | `____` | `____` | ☐ |
| RPO (actual data-loss window) | `____` | `____` | ☐ |

- Detected at (UTC): `____`
- Recovery started at (UTC): `____`
- Service restored at (UTC): `____`
- **Measured RTO** (restored − detected): `____`
- Last good data timestamp before the event: `____`
- First recovered data timestamp: `____`
- **Measured RPO** (data-loss window): `____`

## Backup / snapshot used

- Store: `____`  Backup key / snapshot name: `____`
- Backup age at recovery: `____`
- `verify-backup.sh` result before restore (paste): 

  ```
  ____
  ```

## Timeline (append-only; UTC)

| Time | Actor | Action | Result |
|------|-------|--------|--------|
| `____` | `____` | `____` | `____` |

## Commands executed (verbatim, with output tails)

```
____
```

## Validation results

- [ ] `kubectl rollout status` clean — paste: `____`
- [ ] Gateway `Programmed=True`; HTTPRoute `Accepted`/`ResolvedRefs` True: `____`
- [ ] DNS resolves to expected LB IP: `____`
- [ ] `curl https://api.neuropause033.com/health` → 200: `____`
- [ ] DB-backed read path returns expected data: `____`
- [ ] Restore-test table count (if applicable): `____`
- [ ] Qdrant collection/point counts (if applicable): `____`
- [ ] Databases still private (no `0.0.0.0/0`): `____`
- [ ] `/metrics` externally 404: `____`
- [ ] Observability targets UP / dashboards populated: `____`

## Deviations from the plan

What in `DR-PLAN.md` / `cluster-rebuild.md` was wrong, missing, or slower than
expected:

```
____
```

## Corrective actions (open tickets)

| Action | Owner | Ticket | Due |
|--------|-------|--------|-----|
| `____` | `____` | `____` | `____` |

## Sign-off

- Incident Commander: `____`  Date: `____`
- README.md measured column updated in PR: `____`
