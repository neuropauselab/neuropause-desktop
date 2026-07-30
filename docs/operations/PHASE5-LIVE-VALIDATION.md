# NEMS Version 2.0 — Phase 5 Live Operational Validation

Everything in this record comes from observed output of commands executed
against the live production environment on **2026-07-30** (13:05Z–16:57Z),
via operator-executed, hash-gated validation blocks whose full transcripts were
captured in-session (`/tmp/nems-p5-*.txt` on the operator machine). Nothing is
inferred; where a value could not be observed it is marked so.

## 1. Environment (observed)

| Item | Observed value |
|------|----------------|
| Cluster | `do-nyc3-nems-prod-cluster` (`nems-prod-cluster`, nyc3, id `7750e61a-2636-4220-85ea-aec4120bae40`), status `running`, k8s **1.36.0-do.3** |
| Nodes | 3 × `nems-prod-pool-1-*`, Ready, Debian 13 (trixie), containerd 2.2.3 |
| Backend | `nems-backend` 2/2 Running, image digest `997f8737…d00bbe6` (rc.4), rollout revision 3 |
| PostgreSQL | `nems-prod-pg`, **online**, pg 18, `db-s-1vcpu-2gb`; databases: defaultdb, `nems` (app), `nems_restore_scratch` (drill) |
| Valkey | `nems-prod-cache`, online, v8 |
| Qdrant | in-cluster StatefulSet 1/1, `qdrant/qdrant:v1.18.2`, svc `qdrant:6333` (api-key auth) |
| Edge | Gateway `Programmed=True`; HTTPRoute `Accepted=True`; DNS → `134.199.250.188`; TLS Let's Encrypt (YR2), notAfter 2026-10-26 |
| Tooling | helm v4.2.3, kubectl client v1.36.3, doctl (Spaces-keys capable) |
| Observability stack | chart **kube-prometheus-stack-87.21.0** rev 2; operator v0.92.1; Prometheus v3.13.1; Alertmanager v0.33.1; Grafana 13.1.1; blackbox v0.25.0 |
| Pre-existing (discovered) | cert-manager v1.21.0 (Helm, Jul 28); Spaces buckets `nems-prod-{uploads,ai-artifacts,logs,reports,exports}` + `nems-prod-backups`; keys `nems-app-key`, `nems-backups-key` |

## 2. Task verdicts

| Task | Verdict | Key observed evidence |
|------|---------|----------------------|
| 1 Deploy observability | **PASS** | helm `deployed`; 9/9 pods Ready; 3 PVCs Bound (50Gi/5Gi/5Gi); ClusterIP-only |
| 2 Prometheus | **PASS** (after D1) | 25→27 targets all UP; `nems-backend` pool 2/2 UP; all 8 `neuropause_*` metrics scraped with real values |
| 3 Grafana | **PASS** (after D4) | anonymous 401 / authed 200; datasource health OK; 4/4 NEMS dashboards imported; 36/36 panel queries executed, **error=0** |
| 4 Alertmanager | **PASS** (after D3+D5) | route tree rendered correctly; live fire→route→deliver observed (Slack screenshot); inhibition `suppressed/inhibitedBy=1`; real alert fire→resolve cycle (RejectedResources 13:22:58→~14:00) |
| 5 Blackbox | **PASS** | 120/120 samples/hr/target, avg=min=1; denylist 404 held every sample; durations avg ~0.05–0.06s, max 0.28s; cert 88d |
| 6 Backup + restore | **PASS** (after D6+D7+D8) | PG: 108,783 B / 288 TOC, upload byte-verified; **restore: 36 tables, 12 s, PASSED**; Qdrant snapshot 2,048 B upload VERIFIED; versioning+lifecycle API-confirmed; managed layer listed (PG daily 34–46 MB ×2; Valkey ×2) |
| 7 Disaster recovery | **PASS (safe scope)** | restore-path drill executed + measured (recovery-evidence-2026-07-30); full cluster-rebuild game-day **documented-pending** (unsafe on prod, per plan) |
| 8 SLO platform | **PASS (partial-runtime)** | all recording rules evaluate; 4 burn alerts loaded `inactive/ok`; observed SLIs: availability error 0, latency fast-fraction 1.0, app-success 1.0 (3h); **28d attainment explicitly not reportable yet** |
| 9 Runbooks | **PASS** | 11 runbook commands executed live and matched production; disk/memory/latency PromQL exercised in LV2/LV3 |
| 10 Security | **PASS with one open FAIL** | see §5; open item: leaked Slack webhook not rotated at assembly time |
| 11 This record | **DONE** | you are reading it |

## 3. Defect register (all discovered live; each fixed minimally and re-validated)

| ID | Defect | Root cause | Evidence | Corrective action | Re-validation |
|----|--------|-----------|----------|-------------------|---------------|
| D1 | Backend not scraped | Service `nems-backend` carried **no labels**; ServiceMonitor selector matched nothing (pool existed, 0 targets) | `metadata` without `labels`; SM selected=11/rejected=0; pool in scrape_pools | live `kubectl label`; manifest backport (`backend-production.yaml`) | 2 targets UP; all metrics flowing (14:00Z) |
| D2 | Latency SLI per-phase | `probe_http_duration_seconds` is per-phase; SLI trivially 1 | 10 per-phase series, all =1; totals live in `probe_duration_seconds` | metric swap across 12 files (rules, dashboard, docs) | `count by (phase)` → single empty-phase series ×2; HighLatency exprs on total |
| D3 | AlertmanagerConfig rejected | referenced `alertmanager-pagerduty` secret absent | operator log: `unable to get secret "alertmanager-pagerduty"` | Slack-only receivers (PD restorable later); secret created | selected=1/rejected=0; RejectedResources alert **resolved** |
| D4 | App-success SLI blank when healthy | `sum()` over empty 5xx selector returns empty vector | 5 EMPTY panel queries on a 0-error service | `or vector(0)` on 7 numerators | SLI reads 0 / success 1; panels heal |
| D5 | Backend alerts undeliverable | operator injected `namespace="monitoring"` matcher (OnNamespace default); unlabeled alerts fell to `null` | rendered route tree; AM assignment `receivers=[null]`; Slack: only ns-labeled test alert arrived pre-fix | `alertmanagerConfigMatcherStrategy: None` + explicit `severity=~"critical|warning"` scope | asserts PASS; re-routed alerts delivered to Slack post-fix |
| D6 | Lifecycle JSON unusable via API | top-level `_comment` member | API: `Unknown parameter … "_comment", must be one of: Rules` | member removed from committed file | cleaned config accepted; 3 rule IDs read back |
| D7 | Backups of the wrong database | operator URI targeted `defaultdb` (console default), then pool alias `nems-pool` | 1,048-byte “verified” EMPTY dump; restore test `user_tables=0` → loud FAIL; `FATAL: database "nems-pool" does not exist` | URI derived from app `DATABASE_URL_DIRECT` (db `nems`, private VPC host) | backup 108,783 B / 288 TOC; restore 36 tables PASSED |
| D8 | Qdrant snapshot endpoint wrong | authored `/full-snapshots`; Qdrant v1.18.2 uses `/snapshots` | 404 with valid api key | endpoint corrected in embedded script | snapshot created + upload VERIFIED |

Fix commits (chronological): `16014f4`, `51be0f5`, `55bf698`, `2371f7d`, `69671c5`, `c0205a3`, `64aef49`.

## 4. Credential incident register

| Incident | Status |
|----------|--------|
| Spaces access key pasted into assistant chat (~15:05Z) | **REMEDIATED**: key revoked via doctl (16:34Z); replaced by least-privilege `nems-backup-runtime` (bucket-scoped RW); one-time full-access `nems-admin-temp` created for bucket config, used once, deleted; final key inventory verified 3 scoped keys |
| Slack webhook URL pasted into assistant chat (~14:27Z) | **OPEN at assembly**: secret `alertmanager-slack` still created 2026-07-30T13:57:54Z → the exposed webhook remains the active delivery credential. Required action: new webhook, recreate secret, delete old webhook. See final check line at the end of this document. |

## 5. Security validation detail (all observed 16:56Z)

- Exposure: **only** `cilium-gateway-nems-gateway` (LoadBalancer `134.199.250.188`) is non-ClusterIP cluster-wide; only HTTPRoute is `nems-backend`.
- Edge: `/metrics`, `/api/v1/query`, `/graph`, `/login`, `/alertmanager` → **404**; `/health` → 200 (control). Continuous denylist probe: 404 held every sample all day.
- Prometheus/Grafana/Alertmanager: ClusterIP-only; Grafana anonymous API → 401, authenticated → 200; admin credential in `grafana-admin` secret.
- Database firewalls: both instances expose exactly one rule — `k8s:7750e61a-…` (this cluster). **No `0.0.0.0/0`.**
- PSA: `nems-prod` enforce/audit/warn=`restricted` — **proven live** (unhardened Job pods rejected with `violates PodSecurity "restricted:latest"`, then admitted once compliant). Finding F1: `monitoring` namespace has **no PSA labels** (node-exporter requires host access; recommend explicit `baseline` labels as deliberate policy).
- NetworkPolicies: **none exist** (known deferred item from Phase 4.9; now includes scoping for backup-job egress).
- ServiceAccounts: backend SA `automountServiceAccountToken: false`; monitoring SAs are chart-standard.
- Secrets: inventoried by name only (15 in nems-prod, 14 in monitoring); no values ever printed by validation tooling; backup URIs and API keys handled in-shell only.

## 6. Alert delivery timeline (operator-observed, IST = UTC+5:30)

- 13:22:58Z fire `PrometheusOperatorRejectedResources` → **delivered to Slack** (real, non-test alert) → resolved ~14:00Z after D3 fix. A complete unstaged fire→deliver→resolve cycle.
- 14:24:15Z test alerts fire. Pre-fix Slack: **only** `[CRITICAL] NEMSTestPageNS` (7:54 PM IST) — D5 confirmed at delivery layer.
- Post-fix (~8:00–8:01 PM IST): `NEMSTestPageNS` re-notified (config reloads reset group state) and `[CRITICAL] NEMSTestPage` delivered (screenshot evidence).
- 14:37:37Z inhibition pair fires: critical active→`nems-page`; warning `suppressed, inhibitedBy=1`.
- 14:39:43Z teardown; Prometheus clean; AM resolution via endsAt expiry (~14:43Z); resolved notifications expected 8:13–8:18 PM IST.
- **Operator attestation pending at assembly** for: `[warning] NEMSTestTicket` and `[CRITICAL] NEMSTestInhibit` arrival times, the RESOLVED batch, and the (required) absence of `[warning] NEMSTestInhibit`.

## 7. Observed values snapshot (for the record, partial runtime)

Availability error ratio 0 (all windows); latency fast-fraction 1.0; app-success 1.0 over 3h (39 requests lifetime: {200:5, 302:1, 400:4, 401:27→28 after positive control, 404:2}); probe durations avg 0.052–0.061s, max 0.281s (1h); cert 88.1 days; PG pool total=1/idle=1/waiting=0 per pod; backend RSS ~83 MB, heap ~24 MB, working set ~7.3% of limit; node CPU ~13%, mem ~38%, FS free ~89%; PVC free ~93%; Prometheus head ~48.8k series. Empirical: metrics middleware excludes `/health`/`/live` (totals byte-static across ~76 probe hits; +1 on a real request).

## 8. Known limitations (explicit)

1. **Runtime depth**: scraping began 13:16Z; all long-window SLO figures cover hours, not the 28-day objective window — attainment reporting begins after a full window.
2. Qdrant snapshot **restore** drill pending (quarterly game-day); capture+upload validated. Vector store currently has **0 collections** (provisioned-but-unused; consistent with Phase 4 open item).
3. Full cluster-rebuild game-day pending (documented in dr/cluster-rebuild.md).
4. No request-latency histogram / per-route metrics (immutable app; edge whole-service latency stands in).
5. `neuropause_health_alerts_total` legitimately absent until a dependency transition occurs.
6. Cilium ServiceMonitor inert until Cilium metrics are enabled (by design).
7. PodMonitors: CRD present, zero objects **by design**.
8. Managed-DB internals observed via DO (backups listed); engine metrics remain console-side.

## 9. Remaining operator actions

1. **Rotate the leaked Slack webhook** (the one open security FAIL).
2. Provide the pending Slack delivery attestation (§6).
3. Begin monthly PG restore-drill cadence (scratch DB retained) and daily `verify-backup.sh --deep` (needs aws CLI + pg_restore on the operator machine, or run the in-cluster equivalent used today).
4. Quarterly: full DR game-day; Qdrant snapshot-restore drill; Alertmanager delivery test; cert-renewal check (cert-manager v1.21.0 now identified as the issuer).
5. Push the validation commits to origin (8 commits ahead after this record's commit).

## 10. Deferred improvements (recorded, not implemented — no scope creep)

NetworkPolicies (default-deny + scoped egress for backup jobs; the 4.9 metrics policy); explicit `baseline` PSA labels on `monitoring`; versioning on the five pre-existing app buckets; backup job logging its target database name; per-route/latency app instrumentation (Phase 6+ candidate); PagerDuty receiver restoration when a routing key exists; multi-region DR; downgrading was already done for Spaces keys (least-privilege runtime achieved).

## 11. Production readiness assessment

The observability, alerting, backup, and restore capabilities of Phase 5 are
**validated in production by execution**, with eight defects found and fixed
during validation — five of which (D1, D3, D5, D6, D7) would have silently
disabled monitoring, alert delivery, or disaster recovery had validation been
skipped. The platform is production-ready for single-region operations **conditional on**
rotating the exposed Slack webhook (open FAIL), with maturity items tracked
honestly: SLO windows need runtime, two game-day drills remain scheduled rather
than executed, and defense-in-depth items (NetworkPolicies, monitoring PSA)
are deferred by explicit decision.

## 12. Completion criteria mapping

- ✓ Prometheus scraping verified (§2 T2)
- ✓ Grafana dashboards verified (§2 T3)
- ✓ Alertmanager validated (§2 T4, §6)
- ✓ Blackbox probes verified (§2 T5)
- ✓ Backup validated (§2 T6)
- ✓ Restore validated (§2 T6, drill record)
- ✓ Disaster recovery executed in safe scope; cluster rebuild explicitly pending (§2 T7)
- ✓ SLO calculations verified, insufficient runtime recorded (§2 T8)
- ✓ Runbooks validated (§2 T9)
- ✓ Security verified with one open FAIL stated (§5)
- ✓ PHASE5-LIVE-VALIDATION.md generated (this document)

FINAL WEBHOOK CHECK AT COMMIT TIME: OPEN - leaked webhook still active (secret created 2026-07-30T13:57:54Z)
