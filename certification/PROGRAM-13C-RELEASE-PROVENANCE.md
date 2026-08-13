# PROGRAM 13C — RELEASE PROVENANCE

## Certification baseline

```
branch   feat/understanding-holds-motion-system
commit   927b7bf8288d1b25245b8df69b6db7ec51dc0180
tree     clean except untracked *.patch working files
digest   apps/desktop/src + packages/shared/src — 2416 files
         sha256 58d857a7063bf7dd06c0ce4f4ad0f909e07bebcc8373f4129731e90ceec4d313
```

Certification changes are delivered as `round18.patch` and are NOT part of the
baseline. Any artifact built before that patch is applied does not contain the
F22 registration fix.

## The distributed Windows artifact

```
product        NeuroPause OS
version        1.0.0-rc.15      channel beta
gitCommit      aec87bd          branch feat/understanding-holds-motion-system
dirty          false
buildTime      read from build-info embedded in the artifact
platform       win32            architecture x64
electron       42.8.1           node (pinned) 20
build          windows-latest runner, run 31633030913, 24m18s, success

installer      NeuroPause-Founder-Test-Setup.exe   110,820,498 bytes
               sha256 693ae976fa5d07eab47d0c877e8379a735c4817be900015d1abe21b0b97a587b
portable       NeuroPause-Founder-Test-Portable.exe 110,517,409 bytes
               sha256 3a6a6da7715ef9e38510c4f6b9a5231a16b34d1905b38f40521e1558c5cd39ac

signingStatus        NOT CONFIGURED   (PE certificate table empty — read from the artifact)
notarizationStatus   NOT APPLICABLE (Windows)
certificationStatus  PROGRAM 13C — NOT CERTIFIED
```

## How these values are obtained

No field above is typed by a person. `scripts/make-release-manifest.cjs` computes
the checksum from the shipped bytes, reads version/commit/branch/dirty from the
`build-info.json` electron-builder embedded in that same build, and determines
signing status by parsing the artifact's own PE certificate table — because
`electron-builder` prints `signing with signtool.exe` even on hosts where
`signtool` cannot exist, so its log is not evidence and the certificate table is.

The script refuses to emit a manifest when build-info is missing, and warns when
the caller relies on the local `build-info.json` rather than the one extracted
from the artifact's own zip — the case in which a manifest would confidently
record the wrong commit for the bytes it is checksumming.

## Provenance defects closed on 12 August

- `build-info.json` recorded `rev-parse HEAD` with no working-tree check, so an
  artifact built over uncommitted changes asserted a commit whose tree it did not
  contain. `branch` and `dirty` are now recorded and `commit` gains a `-dirty`
  suffix with a warning. A repo git cannot answer for reports `dirty: null`.
- `ENGINEERING-STATUS.md` pinned a commit by hand and was stale within the hour.
  It now points at the manifest.
- The release workflows uploaded build artifacts **after** publishing to an
  external host. A `scp` timeout destroyed a correct, verified installer. Upload
  now precedes every network step in both workflows.

## Publishing

Publishing to `neuropause033.com` is **OFF** — gated on the repo variable
`PUBLISH_TO_SITE`, and both publish steps are `continue-on-error`. The droplet at
`64.227.128.218` did not answer SSH during this session; that is an unrelated
live-infrastructure question and is recorded here only because it is what
revealed the ordering defect above.
