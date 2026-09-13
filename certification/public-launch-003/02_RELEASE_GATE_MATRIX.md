# NP-PUBLIC-LAUNCH-003 — Release gate matrix

Recorded 2026-09-13T04:37:51.847Z · branch head 6175f3633925b0e7088f85b877563b71d7a3bbc0 · release NP-OS-1.0.0-rc.30-8a253b6a922f

| Gate | Status | Evidence |
| --- | --- | --- |
| G01 SOURCE INTEGRITY | PASS | clean tree 6175f3633925; R3 reproduces f0ba0e8 porcelain=16 digest=27302b8757207bb9 (reproduces) |
| G02 TYPECHECK | PASS | backend tsc clean this seam; desktop node tsc clean this seam; full 53 invocations at 8331185 |
| G03 TESTS | PASS | backend 40 files / 471 tests (this seam, after hardening) (this seam); desktop ai loop 24/24 (this seam); full suites at 8331185: 10,864 node / 539 UI |
| G04 BUILD | PASS | build exit 0 at 8331185 (evidence 8a253b6); no packaged-source change since |
| G05 PACKAGE | PASS | mac universal + win packages at 8331185; controls all detected |
| G06 ARTIFACT IDENTITY | PASS | NP-OS-1.0.0-rc.30-8a253b6a922f; dmg 54b49f198453…; zip 22052c3861af…; win fc13c84d041e… |
| G07 MAC SIGNING | PASS | Developer ID Application (J3G89MY3QG), runtime flag, secure timestamp 13 Sep 2026 09:26:36 (codesign Timestamp=, secure timestamp present), deep/strict verify, nested 14 |
| G08 MAC NOTARIZATION | EXTERNAL_REQUIRED | NOT_NOTARIZED; credentials absent locally; CI keychain step failed at rc.29 |
| G09 MAC GATEKEEPER | FAIL | source=Unnotarized Developer ID |
| G10 WINDOWS SIGNING | EXTERNAL_REQUIRED | UNSIGNED (cert table 0); no certificate |
| G11 UPDATE FEED | PASS | local feed ↔ ZIP sha512/size/path bound (MEASURED); public feed NOT_MEASURED (host down) |
| G12 CLEAN INSTALL | NOT_MEASURED | build machine only |
| G13 UPDATE TRANSITION | NOT_MEASURED | no executed transition |
| G14 ROLLBACK | NOT_MEASURED | automatic NOT_SUPPORTED by design; manual not exercised |
| G15 INTEL RUNTIME | NOT_MEASURED | 15/15 universal (MEASURED); no Intel execution |
| G16 LIVE BACKEND | PASS | 26/26 against source backend (8331185); production 530 → G28 |
| G17 LIVE AI | PASS | local Ollama qwen3-coder:30b via gateway: nonce answer, write stopped, injection resisted (8331185 evidence); production provider HUMAN_REQUIRED |
| G18 AI AUTHORITY SEPARATION | PASS | refutation reviewer measured 8331185/1692e3a: F1 BYPASS (decision replay) fixed at 1692e3a; F2 GAP (decision bound to id only) + class floor + malformed proposal + envelope executes_tools fixed at cd196fb and pinned by 34 loop/phrase tests + 17 gateway tests (this seam). Residual, recorded not hidden: no production caller of the governed loop exists (ABSENT surface); per-IP limit shares a bucket behind a proxy (availability, not authority). |
| G19 TOOL GOVERNANCE | PASS | default DENY; single-use decisions; class matrix in 14_AI_TOOL_GOVERNANCE.json; loop not yet wired to any IPC (no renderer surface) |
| G20 DEPENDENCY SECURITY | HUMAN_REQUIRED | {"info":0,"low":0,"moderate":5,"high":1,"critical":0,"total":6}; per-finding status in 15_DEPENDENCY_SECURITY.json |
| G21 OBSERVABILITY | FAIL | improved this seam (build_info + AI gateway request/token/latency metrics added); alert rules/dashboards DECLARED but undeployed; 12 of 15 required signals still ABSENT as metrics — see 16_SUPPORT_PRIVACY.json reviewer facts |
| G22 SUPPORT | FAIL | mailboxes unverified; reset mail undeliverable; no export/deletion |
| G23 PRIVACY | HUMAN_REQUIRED | facts inventory present; legal review absent |
| G24 REGULATORY REVIEW | HUMAN_REQUIRED | facts-only matrix (17); determinations absent |
| G25 INTENDED USE | HUMAN_REQUIRED | NOT_ESTABLISHED |
| G26 RELEASE VERSION | HUMAN_REQUIRED | coherent at 1.0.0-rc.30; decision pending |
| G27 PUBLIC RELEASE AUTHORIZATION | HUMAN_REQUIRED | ABSENT |
| G28 PRODUCTION INFRASTRUCTURE | EXTERNAL_REQUIRED | apex DNS absent; edge 530; domain expiry 2026-09-15 |
| G29 PROVENANCE | BLOCKED | local chain MEASURED to SIGNATURE; NOTARIZATION/FEED-PUBLIC/HOST/DOWNLOAD ABSENT; A/B identity NOT_ESTABLISHED |
| G30 HUMAN RELEASE DECISION | HUMAN_REQUIRED | no decision artifact |

Summary: {"PASS":12,"EXTERNAL_REQUIRED":3,"FAIL":3,"NOT_MEASURED":4,"HUMAN_REQUIRED":7,"BLOCKED":1}
