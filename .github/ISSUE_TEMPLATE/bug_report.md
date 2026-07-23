---
name: Bug report
about: Report a defect so it can be reproduced and fixed
title: 'fix: <short summary of the bug>'
labels: bug, needs-triage
assignees: ''
---

<!--
  NeuroPause is proprietary and at 1.0.0-rc.1 (Validated Release Candidate).
  This tracker is for internal maintainers and contracted partners.

  ⚠️ SECURITY: Do NOT report vulnerabilities here. Follow SECURITY.md for
  private disclosure. Public security reports will be closed.

  Before filing: search existing issues and check
  docs/guides/TROUBLESHOOTING.md.
-->

## Summary

<!-- One or two sentences: what is wrong? -->

## Environment

- NeuroPause version / commit: <!-- e.g. 1.0.0-rc.1 or a commit SHA -->
- Component: <!-- desktop | backend | sdk | cli | shared | deploy -->
- OS / arch: <!-- e.g. macOS 14 arm64; Ubuntu 22.04 x64 -->
- Node.js version: <!-- node -v (project pins >= 20.11) -->
- Run mode: <!-- npm run dev | production build | deployed -->

## Steps to reproduce

1.
2.
3.

## Expected behaviour

<!-- What you expected to happen. -->

## Actual behaviour

<!-- What actually happened. Include exact error text. -->

## Logs / evidence

<!--
  Paste relevant logs, stack traces, or screenshots.
  REDACT secrets, tokens, and any personal data before pasting.
-->

```
<logs here>
```

## Regression?

<!-- Did this work in a previous version/commit? Which one? -->

## Additional context

<!-- Anything else: frequency, workarounds, suspected area/file. -->

## Checklist

- [ ] I searched existing issues and this is not a duplicate.
- [ ] This is **not** a security vulnerability (those go to `SECURITY.md`).
- [ ] I checked [`docs/guides/TROUBLESHOOTING.md`](../../docs/guides/TROUBLESHOOTING.md).
- [ ] I included version, environment, and reproduction steps.
- [ ] I removed secrets/PII from any logs or screenshots.
