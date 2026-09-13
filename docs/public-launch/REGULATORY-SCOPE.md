# NeuroPause — Regulatory scope (facts for a qualified reviewer; no determination)

The machine makes no regulatory determination. Every classification field is a human decision (NP-GLOBAL-PILOT-003 human decision form, MODE A — all fields blank; sha256 `6ab090d46b76109e…`).

## Intended use

`GATE-INTENDED-USE = NOT_ESTABLISHED`. No intended-use statement exists in any custody. The reviewer briefing pack is `certification/pilot-gate-closure/REVIEWER-BRIEFING-PACK.md`.

## The medical-device traceability module — technical description only

Location: `apps/desktop/src/renderer/src/medicalDevices/` (LotCenterPanel, ProductsPanel, TraceabilityPanel, MedicalDevicesView, model) with main-process support under `apps/desktop/src/main/medicalDevice/`.

| Question | Observation (from code) |
| --- | --- |
| What it does | inventory-style records: products, lots, traceability panels (lot/serial tracking, recall-style lookups) |
| What it does not do | it performs no diagnosis, no treatment, no physiological monitoring, and does not control any device |
| Who uses it | an organization user with the module's read/write role permissions (RBAC gate present; no feature-flag/entitlement gate) |
| Patient data | none found in the module's data model |
| Clinical claim text in UI strings | none found |
| Reachability in the shipped build | reachable (bundled as `MedicalDevicesView-*.js`) |

Technical classification offered as an OBSERVATION: **NON-MEDICAL ADMINISTRATIVE FUNCTION (inventory / lot traceability for medical-device products)**. Whether a jurisdiction treats it as a device function follows intended use and is `WAITING_FOR_QUALIFIED_REVIEW` (US FDA intended-use analysis; EU MDR 2017/745 Art. 2 / Rule 11; India CDSCO Medical Devices Rules 2017 and amendments).

## What must be supplied by humans

Intended use · intended users · target population · use environment · indications · prohibited claims · jurisdictions · medical purpose · qualification · classification · pathway · reviewers · signature. Until then `REGULATORY_REVIEW = WAITING_FOR_HUMAN` and no public claim set is authoritative.
