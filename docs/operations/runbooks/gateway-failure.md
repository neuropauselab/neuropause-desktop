# Runbook — Edge / gateway failure

**Scenario:** External HTTPS to `api.neuropause033.com` fails while backend pods are healthy — a problem at the Cilium gateway, load balancer, DNS, or TLS.
**Fires as:** SEV1 (edge down) to SEV2
**Owner:** platform-oncall
**Backing alerts:** EdgeDown, DenylistLeak

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- `EdgeDown` firing while backend targets are UP (blackbox edge probe failing but in-cluster health fine).
- `DenylistLeak` means `/metrics` became externally reachable — a routing regression (Phase 4.9 posture is that `/metrics` must be 404 at the edge).

## Diagnosis

- Gateway: `kubectl -n nems-prod get gateway nems-gateway -o wide` — expect `Programmed=True`; `describe` for listener/TLS errors.
- Load balancer: `kubectl -n nems-prod get svc` — the external IP must remain `134.199.250.188` (a changed IP breaks DNS).
- Route: `kubectl -n nems-prod get httproute nems-backend -o wide` — `Accepted` and `ResolvedRefs` True; it carries the 10 committed path prefixes (committed at `ecfed7f8`).
- DNS: `dig +short api.neuropause033.com` → `134.199.250.188`.
- Data plane: `kubectl -n kube-system get pods -l k8s-app=cilium` all Ready.
- TLS: if handshake fails → `certificate-expiry.md`.

## Recovery

- Missing/!Accepted route or gateway → re-apply the committed manifests (HTTPRoute at `ecfed7f8`).
- Cilium data-plane issue → `kubectl -n kube-system rollout restart ds/cilium` (with care).
- Wrong LB IP → investigate the LoadBalancer service / DO LB; restore DNS to the correct IP.
- `DenylistLeak` → restore the route that keeps `/metrics` off the public listener; do not expose it.

## Validation

- `nems-gateway` `Programmed=True`; `nems-backend` route `Accepted`/`ResolvedRefs` True.
- `curl https://api.neuropause033.com/health` → 200; `curl https://api.neuropause033.com/metrics` → 404 (denylist intact).

## Escalation

- LB/networking fault at the platform → DigitalOcean support.
- Not restored within target → Incident Commander; consider `../dr/DR-PLAN.md` §5.

## Related

`certificate-expiry.md`, `backend-down.md`, `../dr/DR-PLAN.md`
