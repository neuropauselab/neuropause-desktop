# Support

How to get help with NeuroPause. Please check the documentation below **before**
opening an issue — most questions are answered there.

> **Honest status.** NeuroPause is at **1.0.0-rc.1 (Validated Release
> Candidate)** and is **proprietary** ([`LICENSE`](LICENSE)). There is **no
> public support channel, forum, chat, or ticketing SLA yet** — a public support
> model is _proposed_, not operating (framework in
> [`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md)).
> Today, support is **self-service via the docs** for everyone, plus the
> **internal/partner channels** in your agreement. This file will not point you at
> a channel that does not exist.

---

## Start with the documentation

| I want to…                            | Read                                                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand the project & architecture | [root `README.md`](README.md)                                                                                                                                  |
| Install and run it                    | [Installation](docs/guides/INSTALLATION.md) · [Quick Start](docs/guides/QUICK-START.md)                                                                        |
| Fix something that broke              | [Troubleshooting](docs/guides/TROUBLESHOOTING.md)                                                                                                              |
| Understand sign-in / OAuth            | [Authentication](docs/AUTHENTICATION.md)                                                                                                                       |
| Deploy the backend                    | [Deployment](docs/DEPLOYMENT.md) · [`deploy/README.md`](deploy/README.md)                                                                                      |
| Administer (orgs, RBAC, identity)     | [Administrator Guide](docs/guides/ADMINISTRATOR-GUIDE.md)                                                                                                      |
| Run it in production (day-2)          | [Operations Guide](docs/guides/OPERATIONS-GUIDE.md)                                                                                                            |
| Back up / recover                     | [Disaster Recovery Guide](docs/guides/DISASTER-RECOVERY-GUIDE.md)                                                                                              |
| Review the security posture           | [Security Guide](docs/guides/SECURITY-GUIDE.md)                                                                                                                |
| Build on the SDK / CLI                | [`packages/sdk`](packages/sdk) · [`packages/cli`](packages/cli) · [Plugin SDK](docs/runtime/PLUGIN-SDK.md) · [Connector SDK](docs/connectors/connector-sdk.md) |
| See the full doc index                | [`docs/README.md`](docs/README.md)                                                                                                                             |

The single source of truth for what is shipped vs. modeled vs. absent is the
[Enterprise GA Assessment](ENTERPRISE-GA-REPORT.md) and the honesty labels in
[`docs/README.md`](docs/README.md#reading-the-honesty-labels).

---

## Reporting a security vulnerability

**Do not open a public issue or PR for anything security-related.** Follow the
private disclosure process in [`SECURITY.md`](SECURITY.md). This is the one
channel that is fully defined today.

---

## Reporting a bug or requesting a feature

For **internal maintainers and contracted partners** working in this repository:

- **Bugs** — open an issue with the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).
  Include version, environment, reproduction steps, and expected vs. actual
  behaviour.
- **Features / changes** — open an issue with the
  [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Larger
  or cross-cutting proposals go through the **RFC process** in
  [`docs/adoption/COMMUNITY-GOVERNANCE.md`](docs/adoption/COMMUNITY-GOVERNANCE.md#2-rfc-process).
- **Questions about contributing** — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

Please search existing issues first to avoid duplicates.

---

## What is _not_ available yet (honest gaps)

- **No public support channel** — no community forum, chat/Discord/Slack, or
  public help desk. Proposed, not live.
- **No support SLA or tiered enterprise support desk** — an enterprise support
  model (tiers, response targets, escalation) exists only as a _framework_ in the
  adoption docs, with **no numbers presented as committed**.
- **No paid-support purchase path** yet. Commercial tiers exist in code
  (`free` / `starter` / `professional` / `enterprise`) but are **not** a support
  contract.

If you have a written agreement with NeuroPause, use the contact and escalation
path defined there. Otherwise, the documentation above is the supported route.
