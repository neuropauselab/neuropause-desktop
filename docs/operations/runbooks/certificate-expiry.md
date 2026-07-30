# Runbook — TLS certificate expiry / handshake failure

**Scenario:** The edge certificate for `api.neuropause033.com` is near expiry or TLS handshakes are failing.
**Fires as:** SEV2 (approaching) to SEV1 (expired / handshake failing)
**Owner:** platform-oncall
**Backing alerts:** CertificateExpiringSoon, CertificateExpiringCritical

> Operational runbook. It describes how to respond; it records no incident.
> Commands assume `kubectl` context on `nems-prod-cluster` and, where noted,
> `doctl` authenticated to the DigitalOcean account.

## Detection

- `CertificateExpiringSoon` (warning, <21d) or `CertificateExpiringCritical` (<7d), derived from `probe_ssl_earliest_cert_expiry{tier="edge"}`.
- Clients report TLS errors; handshake fails.

## Diagnosis

- Remaining lifetime: `echo | openssl s_client -servername api.neuropause033.com -connect api.neuropause033.com:443 2>/dev/null | openssl x509 -noout -dates` (issuer has been Let's Encrypt).
- Secret contents: `kubectl -n nems-prod get secret api-neuropause033-tls -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -enddate`.
- Renewal mechanism: confirm what issues the cert (ACME controller / DO) and whether renewal is failing; check the ACME challenge path is reachable through the gateway.

## Recovery

- If auto-renewal is healthy but slow, allow it to complete and confirm the new `notAfter`.
- If renewal is broken, fix the challenge path (HTTP-01 must route, or DNS-01 records must resolve), then re-issue and update the `api-neuropause033-tls` secret.
- Watch Let's Encrypt rate limits if re-issuing repeatedly.

## Validation

- `probe_ssl_earliest_cert_expiry` now > 21 days out; TLS 1.3 handshake succeeds; alerts clear.

## Escalation

- Renewal keeps failing or rate-limited → Incident Commander; consider a temporary cert from an alternate path.

## Related

`gateway-failure.md`
