# Ecosystem Analytics

A network-wide rollup over the marketplace, installs, billing, exchange,
partners, and gateway usage — computed by a pure function
(`exchange/analytics.ts`).

## What it shows

- **Health score** (0–100) from four signals: listing quality (published
  ratio), certification coverage, update adoption (fraction of installs on the
  current version), and partner coverage (types represented). Each signal scores
  good / watch / risk; the score is their average, labeled Healthy / Stable /
  Needs attention.
- **Revenue** — gross, platform fees, and net to developers, from real
  marketplace purchases.
- **API usage** — 30-day requests, compute units, and p95 latency from the
  gateway + developer usage ledger.
- **Network** — listings, published, certified, total installs, active
  developers, active organizations, and packs.
- **Marketplace growth** — cumulative listings across the last six months.
- **Top listings** by installs, and the **listing mix** by kind.

## Honest seam — growth synthesis

There is no separate per-day history table. The six-month growth series is
synthesized deterministically from each listing's `createdAt` and the install
dates, so it reflects real records without a dedicated time-series store. Active
organizations are counted as the local org plus the distinct organizations that
publish exchange packs or hold installs.

## IPC

`ipc.ecosystem.analytics`.
