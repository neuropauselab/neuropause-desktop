SAURABH PATEL — PILOT-CLASS GOVERNANCE AMENDMENT v1.0
Programme: NeuroPause OS
Date: 19 September 2026
Decision-maker: Saurabh Patel
Purpose: Establish a bounded, non-production pilot exception to the current Windows-signing requirement

1. Human decision
I authorize the establishment of a bounded Pilot Class for NeuroPause OS.

This amendment is intended to permit a controlled pilot using an unsigned Windows artifact, while preserving the existing production release, production deployment, and public update-feed controls.

This is a governance amendment for the pilot class only.

It is not a production release authorization.

It is not a deployment authorization.

It is not pilot execution authorization.

It is not authorization to bypass existing production protections.

2. Scope of exception
For the specifically a:

PILOT_CLASS = TRUE

A Windows artifact that has not yet received the future production Windows code-signing certificate may be used only within the bounded pilot
distribution channel ess.

The exception does not apply globally to all Windows builds or all release
paths.

The existing production signing requirement remains unchanged outside this Pilot Class.

3. Public update-feed
An unsigned pilot artifact must not enter the public NeuroPause update feed.

In particular, this amendment does not authorize:

publication to the public production update feed;
replacement of a signed production artifact with an unsigned artifact;
public updater distribution;
modification of production feed policy outside the Pilot Class.
The pilot distribution channel must be separately identified and controlled.

If the required contronot be established andverified, the unsigned pilot must not proceed.

4. Production boundary
An artifact distribute

is not a production release;
is not a production deployment;
does not establish production release authority;
does not establish production signing;
does not establish production readiness;
must not be represented as a signed or certified production artifact.
The Pilot Class must not be interpreted by any automated system as production authorization.

5. Candidate and environment binding
The Pilot Class must be bound to the specific successor candidate and pilot
environment identifiednce path.

It must not automatically apply to:

future commits;
future releases;
production environment
unrelated branches;
unrelated artifacts.
Any extension requiresxplicitly definedrenewal mechanism within the authoritative governance instrument.

6. Duration and revocation
This exception is temp bounded pilot.

It expires when the authorized pilot concludes, or at the earlier expiry defined by the authoritative successor governance instrument.

The authority responsible for the Pilot Class may revoke it before expiry.

After expiry or revocation, unsigned artifacts must not continue to rely on this exception.

7. Certificate sequencing
The Windows production certificate remains intentionally deferred until
after the pilot.

This amendment does not authorize certificate purchase, certificate issuance, certificate installation, or production signing.

Following the pilot, a separate human decision will determine whether to:

proceed toward production;
purchase/acquire the appropriate Windows certificate;
provision the protecte
establish signer identity pinning;
produce and verify a signed successor candidate;
conduct the required production release verification.
8. Governance requirem
This amendment must not be treated as operative merely because it has been written or signed.

It must be incorporated through the established reviewed successor path and subjected to the applicable governance and cryptographic verification.

In particular, the successor verification must establish:

issuer identity;
authority instrument;
trust-root binding;
candidate binding;
pilot-class binding;
environment binding;
signing-byte coverage;
subject digest;
signature validity;
pilot/production separ
public-feed restriction.
9. Cryptographic integrity
All security-relevant horization must becovered by the authoritative signing mechanism.

The following distinctions must not be mutable outside the
cryptographically boun

Pilot versus Production;
authorized candidate;
authorized environment;
distribution scope;
public-feed prohibition;
authority scope;
validity/expiry;
issuer.
A valid signature on a Pilot-Class authorization must not be transformable into production authority through deletion or modification of unsigned
fields.

This requirement specifically requires re-verification of the previously identified SIGNED_FIELDS envelope defect.

10. Human authority remains separate
This amendment does no the machine.

The following remain separate human decisions:

Pilot-Class exception: authorized by this amendment.

Pilot execution: requiation.

Production release: requires a separate human authorization.

Production deployment: requires a separate human authorization.

Certificate acquisitioer the pilot.

11. No bypass
Nothing in this amendm

bypassing branch prote
bypassing environment protection;
bypassing required review;
self-approval;
alteration of sealed evidence;
substitution of machin
publication of an unsigned artifact to the public update feed;
production deployment
If the repository implementation cannot enforce this bounded distinction, the pilot exception is not established, regardless of this document.

12. Decision
I therefore authorize:

PILOT_CLASS_GOVERNANCE_AMENDMENT = AUTHORIZED

UNSIGNED_PILOT_EXCEPTI SUBJECT TO SUCCESSORGOVERNANCE IMPLEMENTATION AND VERIFICATION

I do not authorize:

PILOT_EXECUTION = NOT AUTHORIZED

PRODUCTION_RELEASE = N

PRODUCTION_DEPLOYMENT

PUBLIC_UPDATE_FEED_PUBLICATION = NOT AUTHORIZED

WINDOWS_CERTIFICATE_PROVISIONING = DEFERRED UNTIL AFTER PILOT

13. Effective condition
This amendment becomesesignated governanceprocess establishes and verifies the corresponding successor candidate and its authority chain.

Until then:

CURRENT PRODUCTION SIGNING REQUIREMENT REMAINS IN FORCE.

CURRENT PUBLIC UPDATE-FEED POLICY REMAINS IN FORCE.

The machine must not infer that this document alone has changed either policy.

Signed by:
Saurabh Patel
Founder / Lead Maintainer

Date: 19 September 2026

Signature: Saurabh Patel