# Failure UX — user-visible states

| Condition | Shown as | Measured |
| --- | --- | --- |
| NOT_PERMITTED (unknown tool) | tool result status NOT_PERMITTED; model sees [NOT_PERMITTED] | unit |
| DECISION_REQUIRED (side-effect tool) | loop terminal HUMAN_DECISION_REQUIRED with pending_decisions | unit + live |
| AI_UNAVAILABLE | gateway 503 ai_unavailable; desktop deterministic fallback with reason | unit |
| BACKEND_UNAVAILABLE | local mode banner "Working locally…"; credentials kept | packaged smoke + unit |
| SIGN_IN_FAILED (genuine 4xx) | credentials cleared; sign-in wall | unit |
| UPDATE_FAILED | updater phase error; app keeps running | code |
| OFFLINE | local mode | unit |
| STOPPED | loop terminal STOPPED | unit |

Invariant preserved: WAITING is not FAILED; NOT_PERMITTED is not ERROR; no authorization is never SUCCESS.
