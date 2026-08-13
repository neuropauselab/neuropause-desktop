# NeuroPause — Digital Twin Guide

> **NeuroPause Global Product RC** · Documentation v1.0 · Product build `1.0.0-rc.15` (`0a040e2`) · Last updated 2026-08-08 · Audience: users & evaluators
>
> Maturity: **Preview** — real code running on modeled/seeded data, surfaced with a Preview banner. It is **not** a separately deployed cloud service.

## What the Digital Twin represents

The **Digital Twin** is a modeled representation of your organization — its units, resources, and state — that you can explore and analyze in one place. It's a way to ask "what does the organization look like right now, and how do the pieces relate?" without stitching together separate tools. Open it from **Advanced → Digital Twin Center**.

## What feeds it

The twin is a **projection over your existing enterprise state** — the same local-first data the rest of NeuroPause uses (organization model, records, relationships). It is computed on demand from that data; it does not require, and does not currently include, a separate deployed cloud twin runtime. *(If you see references elsewhere to a cloud twin deployment, that is not part of this build — Not currently verified.)*

## How you use it

- **Explore** the modeled organization and its domains.
- **Analyze** relationships and state to support decisions.
- **Connect** what you see to **Enterprise Knowledge** (the fabric/relationships) and to **AI** surfaces for reasoning.

## How it relates to the rest of NeuroPause

- **Enterprise Knowledge** explains relationships/lineage/evidence; the **Digital Twin** models organizational state. They're complementary lenses over the same local-first data.
- **AI** surfaces can reason over twin/knowledge context (subject to the AI-provider dependency).

## Maturity & known limitations

- **Preview:** the surface runs on modeled/seeded data, not live production twin telemetry.
- Deeper simulation/forecasting and any externally-fed twin data are **dependencies not deployed in this build** — documented, not claimed.
- On-screen behavior is best confirmed on the running desktop app (**Pending GUI** for full visual verification).

## Related

[Knowledge Guide](KNOWLEDGE-GUIDE.md) · [User Guide → Digital Twin](NEUROPAUSE-USER-GUIDE.md#18-digital-twin) · [Glossary](GLOSSARY.md)
