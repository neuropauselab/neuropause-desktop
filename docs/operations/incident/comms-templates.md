# Incident Communication Templates

Fill the `____` fields. Never assert a cause, a scope, or an ETA you have not
verified — "we are investigating" is an honest and acceptable status. Keep
external messages plain and free of internal jargon.

## Internal — initial (on declaration)

```
[NEMS incident] SEV____ — investigating
Impact: ____ (who/what is affected)
Started: ____ UTC
IC: ____   Channel: ____
Next update: within ____ minutes
```

## Internal — ongoing (on cadence)

```
[NEMS incident] SEV____ — ____ (investigating / identified / mitigating / monitoring)
What we know: ____
Current action: ____
User impact now: ____
Next update: within ____ minutes
```

## Internal — resolved

```
[NEMS incident] SEV____ — RESOLVED
Duration: ____ (detected ____ UTC → resolved ____ UTC)
What happened (one line): ____
Follow-up: postmortem by ____   Owner: ____
```

## External — acknowledgement (only if user-facing; per policy)

```
We are aware of an issue affecting ____ and are investigating.
We will share an update by ____ UTC. We apologise for the disruption.
```

## External — resolved

```
The issue affecting ____ was resolved at ____ UTC. Services are operating
normally. Thank you for your patience.
```

> Do not include internal hostnames, IPs, credentials, cluster ids, or metric
> names in external messages. Route external wording through whoever owns
> customer communications before sending.
