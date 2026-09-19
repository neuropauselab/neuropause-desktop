PILOT-ARCHITECTURE-DECISION (record per NP-082-C s26/s55; completed per the
signed §12 HUMAN DECISION of 19/09/2026)

Engineering measurements previously supplied (Computer-B work clone):
  x64-only installer ........ 111,896,990 B
  x64 + arm64 ............... 219,268,503 B
  difference ................ 107,371,513 B
These are measurements, not a policy decision.

Frozen-baseline fact: the governed tree's production win target set is
x64-ONLY (nsis/zip/portable x64) - electron-builder.yml, unchanged.
The drafted pilot config inherited that baseline until the human decision
below was supplied; the pilot config was then revised to arm64 (v2).

Record history: draft v1 of this record stated "HUMAN ARM64 DECISION =
NOT_SUPPLIED". That state is SUPERSEDED by the following signed decision,
captured verbatim:

--------------------------------------------------------------------------
PILOT_ARCHITECTURE = arm64

DESIGNATED_PILOT_ENVIRONMENT = Non-production Windows 11 ARM64 pilot
environment designated by Saurabh Patel, isolated from production
infrastructure and public release infrastructure.

PILOT_SCOPE = Bounded NeuroPause OS pilot implementation, artifact
generation, controlled non-public distribution, installation, installation
verification, and limited pilot execution on the designated non-production
ARM64 environment for functional, operational, provenance, and governance
validation. No production deployment, public release, public feed
publication, unrestricted distribution, or alteration of production
signing/security controls is authorized.

§12 HUMAN DECISION

I, Saurabh Patel, auth designated pilot
environment, and bounded pilot scope for NeuroPause OS pilot
implementation, installation, verification, and execution under the
existing Pilot Implemeization v1.0 and its
production/public-release restrictions.

SIGNATURE = Saurabh Pa

DATE = 19/09/2026
---------------------------------------------

Consequences encoded in this successor PR:
  - apps/desktop/electron-builder.pilot.yml targets win nsis arch [arm64]
    (artifactName NeuroPause-Pilot-Setup-arm64.exe).
  - package.json "package:win:pilot" builds with --arm64 (the earlier
    draft's --x64 was a pre-decision leftover, corrected in admin review).
This record authorizes no build, installation, or execution by itself;
those remain governed