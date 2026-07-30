# NEMS Service Level Objectives & Error Budget Policy

Applies to the production NEMS backend at `https://api.neuropause033.com`
(`nems-backend`, nems-prod, DOKS `nems-prod-cluster`). SLIs are measured by the
Phase 5 observability stack; the recording rules and burn-rate alerts live in
`deploy/observability/prometheusrules-slo.yaml`.

## Service Level Indicators (how each is measured)

| SLI | Definition | Source metric |
|-----|------------|---------------|
| Availability | fraction of external HTTPS health probes that succeed | blackbox `probe_success{tier="edge"}` |
| Latency | fraction of external HTTP probes completing in ≤ 0.5s | blackbox `probe_duration_seconds{tier="edge"}` |
| Application success | fraction of backend responses that are not 5xx | `neuropause_http_requests_total{status}` |

> Honest scope: latency is measured **at the edge from inside the cluster**
> (Prometheus and the load balancer are both in nyc3), so it reflects
> gateway + server time, not end-user network RTT, and it is whole-service, not
> per-route. Per-route latency percentiles require an app-side histogram, which
> is an instrumentation backlog item (the backend code is immutable in Phase 5).

## Service Level Objectives

| SLO | Objective | Window | Error budget |
|-----|-----------|--------|--------------|
| Availability | **99.9%** | rolling 28 days | 0.1% ≈ **40m 19s**/28d |
| Latency | **99.0%** of probes ≤ 0.5s | rolling 28 days | 1.0% |
| Application success | **99.5%** non-5xx | rolling 28 days | 0.5% |

These are the initial internal objectives for a newly-live service. They are
deliberately conservative and should be reviewed after the first full 28-day
window of real data, before being externalised as an SLA.

## SLA (external commitment)

No external SLA is published yet. When one is, it should sit **below** the
internal SLO (e.g. a 99.5% availability SLA against a 99.9% SLO) so the internal
target trips first. Until a signed SLA exists, this document is an internal
operational objective only — it does not represent a customer commitment.

## Error budget policy

The error budget is `1 − SLO` over the rolling window. Burn-rate alerts
(`SLOAvailabilityFastBurn`, `...SlowBurn`, `SLOAppSuccessFastBurn`,
`SLOLatencyBudgetBurn`) page or ticket when the budget is being consumed too
fast.

| Budget remaining | Policy |
|------------------|--------|
| > 50% | Normal operations; feature and infra changes proceed. |
| 10–50% | Change caution: risky changes require a second reviewer; prefer reliability work. |
| < 10% | **Change freeze** on non-reliability changes until the budget recovers; all effort to reliability. |
| Exhausted (SLO missed) | Incident review; freeze until a corrective action is committed. |

## Incident severity (ties to `docs/operations/incident/`)

| Severity | Definition | Example |
|----------|------------|---------|
| SEV1 | Full outage or data-loss risk; error budget burning fast | `EdgeDown`, `BackendNoHealthyReplicas`, `DatabaseUnavailable` |
| SEV2 | Major degradation; SLO at risk | `HighErrorRateCritical`, `SLOAvailabilityFastBurn`, `RedisUnavailable` |
| SEV3 | Minor degradation; budget not yet threatened | `HighErrorRate` (warning), `HighLatency`, `RedisFallbackEngaged` |
| SEV4 | Cosmetic / no user impact | monitoring gaps, single non-critical target down |

## Operational KPIs (reviewed monthly)

- Availability, latency and app-success attainment vs objective (queries below).
- Error-budget consumed this period.
- Alert volume by severity; alert-to-incident ratio (noise check).
- MTTA / MTTR per incident (from `docs/operations/incident/` timelines).
- Change failure rate and count of SEV1/SEV2 caused by change.

## Monthly reporting queries (run in Grafana / Prometheus)

These are queries to run for the report — they are **not** claims of any
achieved number here.

```promql
# 28-day availability attainment
avg_over_time(probe_success{tier="edge",service="nems-backend"}[28d])

# 28-day latency attainment (fraction of probes <= 0.5s)
avg_over_time(nems:edge_probe_fast[28d])

# 28-day application success attainment
1 - (
  (sum(increase(neuropause_http_requests_total{status=~"5.."}[28d])) or vector(0))
  / clamp_min(sum(increase(neuropause_http_requests_total[28d])), 1)
)

# availability error budget consumed this window (as a fraction of the 0.1% budget)
(1 - avg_over_time(probe_success{tier="edge",service="nems-backend"}[28d])) / 0.001
```

Record each month's numbers in an operations review; do not backfill or estimate
values for periods before the stack was scraping.
