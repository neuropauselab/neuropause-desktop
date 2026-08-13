# Phase 4 — Closeout: Pilot Experience + User Documentation + Product Enablement

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: program, engineering, product
>
> Honest closeout for Phase 4. It records what was delivered, how it was verified, and what remains. No claim here exceeds repository evidence. This document is an engineering artifact — it is intentionally **not** part of the user-facing documentation set (not in `DOCUMENT-MANIFEST.json`), so it is not rendered into the docs site.

## 1. Objective (recap)

Produce a complete, honest user-facing documentation and product-enablement system grounded in the repository — no fabricated pricing, SLAs, trial durations, customer logos, screenshots, download links, compliance certifications, or "public HTTP API" claims — with an explicit maturity label on every capability.

## 2. What was delivered

A documentation set spanning eight audiences, plus machine-readable data and a build/validate toolchain.

| Area | Documents |
|---|---|
| **User** | Quick Start · Where Do I Go? · First 30 Minutes · Glossary · User Guide · AI Workforce Guide · Knowledge Guide · Digital Twin Guide · Connectors Guide |
| **Admin** | Admin Guide |
| **Developer** | Developer Guide (Mermaid) · API/SDK Guide (two-surfaces distinction) |
| **Enterprise** | Enterprise Pilot Guide · Data & Security Guide · 30-Minute Demo Script |
| **Product** | Product Brochure · One-Page Sheet · RC Release Notes · Product Tour · Product Catalog · Industry Catalog |
| **Support** | FAQ · Troubleshooting (User & Pilot) |
| **Downloads** | Download Catalog (no artifact published → no fake links) |
| **Machine-readable** | PRODUCT-DATA · INDUSTRY-CATALOG · WEBSITE-PRODUCT-DATA · IN-APP-HELP · ONBOARDING-CONTENT · DOCUMENTATION-INDEX · DOCUMENT-MANIFEST (JSON) |

The authoritative machine list is [`docs/downloads/DOCUMENT-MANIFEST.json`](../downloads/DOCUMENT-MANIFEST.json) — **33 governed documents** (25 Markdown + 8 JSON, counting the manifest itself).

## 3. Tooling

Two zero-dependency Node scripts (they run on a fresh checkout with no `npm install`):

- **`npm run docs:validate`** (`scripts/docs-validate.cjs`) — checks every manifested file exists; markdown docs carry the current metadata header markers; no stale build markers (any `1.0.0-rc.N` where N ≠ 15); no forbidden/renamed-surface terms; relative Markdown links resolve; JSON parses and carries the current build. Exit non-zero on any error.
- **`npm run docs:build`** (`scripts/docs-build.cjs`) — renders the Markdown set to a self-contained HTML site under `dist/docs/` and builds `dist/docs/INDEX.html` (the document hub) from `DOCUMENTATION-INDEX.json`. `--pdf` optionally renders PDFs via a detected Chrome/Chromium; if none is found it **skips honestly** and never fabricates a PDF.

**`dist/` is git-ignored** — generated HTML/PDF are build artifacts and are **not committed**. The committed source of truth is the Markdown, the JSON, and these two scripts.

## 4. Verification evidence

- `npm run docs:validate` → **33/33 clean, 0 issues.**
- `npm run docs:build` → generated **26 manifested docs + 4 linked extras + 7 data files**, hub at `dist/docs/INDEX.html`.
- Visual QA (rendered via headless Chromium in the build environment): the hub and representative content pages (Product Brochure with tables, Trial Checklist with task lists) render correctly — headings, tables, blockquote callouts, code, task lists, and the lifecycle arrows all display as intended.
- **Corrective fix during validation:** the validator caught a renamed-surface echo (an old surface name) in two increment-1 docs (`GLOSSARY.md`, `WHERE-DO-I-GO.md`); both were reworded to the current name. This is exactly the rot the validator exists to catch.

## 5. Honesty posture (what these docs do NOT claim)

No pricing, SLAs, or trial durations (operator/commercial decisions; the build does not hard-code a trial length). No customer logos or product screenshots. No download links or checksums (no signed/notarized artifact is published). No public HTTP Enterprise API (the enterprise surface is in-process typed IPC/SDK). No SOC 2 / ISO 27001 / GDPR / HIPAA certification. Every surface's maturity — Local-first, Cloud, External dependency, Preview, RC, Planned — is stated.

## 6. Known limitations & pending

- **Desktop visual QA on macOS** remains a human task (tracked separately) — the docs say so rather than claiming visual completion.
- **PDF generation** depends on a local Chrome/Chromium; without one, HTML is complete and PDF is skipped honestly.
- The generated HTML site converts the manifested set plus **depth-1** linked repo docs; links to deeper non-manifested repo docs may not resolve inside the site (the Markdown sources always do).
- The documentation is a **snapshot of build `1.0.0-rc.15` (`0a040e2`)**; re-run `docs:validate` after any version bump to catch stale markers.

## 7. Release-gate impact

Increment 5 adds only documentation, two `scripts/*.cjs` files, and two root `package.json` **script entries**. None of these is in a gated workspace: `typecheck:release` runs on workspaces (scripts/ is not one), `lint:release` targets explicit `apps/*` and `packages/*` dirs (not scripts/), and `test:release` gains no tests. **No release-gate regression is possible from this phase.** Run `npm run test:release` on macOS as the authoritative confirmation, per the established per-phase practice.

## 8. Commit sequence (Phase 4)

| Increment | Content | Commit |
|---|---|---|
| 1 | Foundational user docs | `0aad711` |
| 2 | User/Workforce/Knowledge/Digital-Twin/Connectors guides | `1982e87` |
| 3 | Admin + Developer + API/SDK guides | `c255fd9` |
| 4a | Product & Industry catalogs (+ JSON) | `99d1a65` |
| 4b | Enterprise pilot + trial enablement | `5294c93` |
| 4c | Product collateral + machine-readable data | `27976f5` |
| 5 | Support/Downloads/Tour, manifest+index, build/validate tooling, closeout | *(this commit)* |

## 9. How to work with the docs

```bash
npm run docs:validate     # gate the documentation set
npm run docs:build        # regenerate dist/docs/ + INDEX.html
npm run docs:build -- --pdf   # also render PDFs if Chrome is present
open dist/docs/INDEX.html # the document hub
```

## 10. Next

Per the program rule, **do not start the next phase automatically.** Phase 4 is complete and verified as above; await approval before proceeding.

## Related
[Documentation Index](DOCUMENTATION-INDEX.json) · [Document Manifest](../downloads/DOCUMENT-MANIFEST.json) · [Product Brochure](NEUROPAUSE-PRODUCT-BROCHURE.md) · [RC Release Notes](CURRENT-RC-RELEASE-NOTES.md)
