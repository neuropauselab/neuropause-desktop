# PRICING — customer-facing tiers (no billing implemented)

Four tiers on the page, grounded in the real plan vocabulary in the codebase
(entitlements free/pro/enterprise; Razorpay billing names
starter/professional/enterprise):

| Tier | Price shown | Maps to | Positioning |
| --- | --- | --- | --- |
| Free | $0 | entitledPlan `free` | Full app, core tools, on-device AI, 7-day memory |
| Professional | $19/mo | `pro` / professional | All 16 connectors, unlimited memory, daily brief, Founder+Engineering AI |
| Business | $49/mo | `pro`+orgs | Organizations, roles, shared memory, priority support |
| Enterprise | Custom | `enterprise` | SSO, audit logging, deployment support |

**No billing is implemented on the site** (per the brief) — the CTAs route to
download / contact. Prices are placeholders for planning; the page states billing
activates at GA and early-access users are on Free. When C2 (in-app upgrade) is
built, these tiers are the contract it should honor.
