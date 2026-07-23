<!--
  Thanks for contributing to NeuroPause (proprietary — see LICENSE).
  Please read CONTRIBUTING.md first. Keep PRs focused and honest.
  ⚠️ Do NOT include security fixes for undisclosed vulnerabilities here —
  follow SECURITY.md for private disclosure.
-->

## Summary

<!-- What does this PR do, and why? One short paragraph. -->

## Related issue / RFC

<!-- Link the issue or RFC this implements. Use "Closes #123" to auto-close. -->

Closes #

## Type of change

<!-- Match your Conventional Commit type. Check all that apply. -->

- [ ] `feat` — new capability
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` / `perf` / `style` — no behaviour change
- [ ] `test` — tests only
- [ ] `chore` / `ci` / `build` — tooling, deps, pipeline
- [ ] **Breaking change** (`!` + `BREAKING CHANGE:` footer; describe migration below)

## What changed

<!-- Bullet the concrete changes. Note new dependencies, schema/migrations,
     config/env vars, and any change to public SDK/CLI/API surface. -->

-

## How it was tested

<!-- Commands run and what you observed. Paste REAL output/numbers — do not
     transcribe from a previous run. Add tests for new behaviour and fixes. -->

## Quality gates

Run from the repository root; all must be green before review (these are the
real gates enforced in CI and the Release Checklist):

- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — passes under `--max-warnings 0`
- [ ] `npm run test` — Vitest suites pass
- [ ] `npm run build` — production build succeeds (exit 0)
- [ ] `npm run format:check` — no Prettier drift
- [ ] (if touching `deploy/**`) `deploy-validation` passes — `yamllint`, `helm lint`, strict `kubeconform`

## Contribution requirements

- [ ] Commits follow **Conventional Commits** and are **DCO signed-off**
      (`git commit -s`).
- [ ] I am cleared to contribute (internal, or partner/external with a **CLA on
      file**) — see [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- [ ] Code owners for every touched path are requested for review
      ([`CODEOWNERS`](../CODEOWNERS)).

## Honesty check

- [ ] No fabricated customers, metrics, benchmarks, or certifications introduced.
- [ ] Honesty labels (Verified / Modeled / Advisory / Absent) are respected, and
      any new known limitation is disclosed (docs and/or `CHANGELOG.md`).

## Additional notes

<!-- Screenshots, follow-ups, rollout/rollback considerations. -->
