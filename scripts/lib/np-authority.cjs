/**
 * scripts/lib/np-authority.cjs — np-authority/1 (Model E) release-authority admission predicate.
 *
 * PORT of the verified forensic instrument, with IDENTICAL semantics (same DENY/UNKNOWN codes, same
 * evaluation order, same canonical bytes, same signed-field set):
 *   source : NP-GLOBAL-PILOT-007B/R6.2-41/NP-R34.2-B.38_FULL_EVIDENCE/scripts/b38-authority.cjs
 *   sha256 : dbb629b85eb7a48c00bb09fc699e2891cc11775b1c3e50041fb25a38dc727901   (shasum -a 256)
 * Differences from the source are non-semantic only: `require('node:crypto')` instead of
 * `require('crypto')`, one statement per line, and comments. No predicate was added, removed,
 * reordered or re-typed. CommonJS; no dependency beyond node:crypto.
 * That statement describes the original port only. Semantic departures made since are marked where they
 * occur: v1.1 full-object signing, the closed KNOWN_FIELDS set and the release-class checks
 * (NP-RELEASE-081/082), the canon()/signingBytes() own-__proto__ repairs (NP-101, NP-103), and the NP-116
 * (N1) authority-metadata type and value checks in admitAuthority(), with their three new DENY codes.
 *
 * admitAuthority(authority, actual, trust)
 *   `authority` — the externally issued np-authority/1 object (parsed JSON).
 *   `actual`    — what the platform MEASURED: repository id, tag object → commit → tree, manifest bytes,
 *                 population, policy, build policy, run identity, admission/deployment time, the
 *                 deployment review record and the protected-environment capture.
 *   `trust`     — the trust list held outside the subject: { schemaVersion, trustedIssuers,
 *                 signatureAlgorithm, verifySignature(issuer, bytes, sig) => boolean, scope, tagPattern,
 *                 allowedReviewers, consumedNonces, deploymentTimeValidity }.
 *   Returns { verdict: 'ALLOW' | 'DENY' | 'UNKNOWN', code, detail }. Only verdict === 'ALLOW' with
 *   code === 'AUTHORITY_ADMITTED' admits; every other result (including UNKNOWN) is a non-admit.
 *
 * attestationAuthorizes(verification, admitted, artifact)
 *   An artifact attestation is provenance; it becomes AUTHORIZATION only if its subject set includes
 *   the admitted authority's digest (admitted.detail.authority_subject_digest).
 *
 * Every synthetic authority used in tests carries authority_origin = 'FORENSIC_SYNTHETIC_ONLY',
 * real_authority = false, production_validity = false.
 */
'use strict';

const crypto = require('node:crypto');

const H = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hex40 = (s) => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s);
const hex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Canonical JSON: keys sorted at every depth, `undefined` members dropped, arrays kept in order.
 *
 * NP-101 (F3 repair). The rebuild below DEFINES each own key instead of assigning it. Plain
 * assignment routes through the target's prototype chain, and `Object.prototype.__proto__` is an
 * ACCESSOR: `r.__proto__ = value` therefore invoked the setter and set r's prototype instead of
 * creating an own property, so a `__proto__` member present in the input — which `JSON.parse`
 * produces as an ordinary own data key — vanished from the output at every depth. Two
 * semantically distinct objects could canonicalise to identical bytes, and one signature covered
 * both. `Object.defineProperty` creates an own data property for every key including
 * `__proto__`, so distinct inputs stay distinct.
 *
 * This is a serialization-collision repair, not prototype-pollution protection: the old code
 * polluted the fresh local object `r`, never `Object.prototype`. Bytes are unchanged for every
 * input that carries no own `__proto__` key, so previously computed digests still reproduce.
 */
function canon(o) {
  const seen = new WeakSet();
  const f = (v, d) => {
    if (d > 64) throw new Error('depth');
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) throw new Error('cycle');
    seen.add(v);
    if (Array.isArray(v)) return v.map((x) => f(x, d + 1));
    const r = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) {
        Object.defineProperty(r, k, { value: f(v[k], d + 1), enumerable: true, writable: true, configurable: true });
      }
    }
    return r;
  };
  return JSON.stringify(f(o, 0));
}

const R = (verdict, code, detail) => ({ verdict, code, detail: detail === undefined ? null : detail });

/**
 * NP-RELEASE-082 envelope repair (SIGNED_FIELDS defect, sealed finding).
 * v1 signed ONLY the SIGNED_FIELDS subset, so members outside it — including the rehearsal
 * markers authority_origin / real_authority / production_validity — could be DELETED or altered
 * without invalidating the signature, converting a signed rehearsal object into production
 * authority. v1.1 signs the ENTIRE object except `signature` (canonical form), and additionally
 * rejects any field outside KNOWN_FIELDS before signature verification. Schema version is bumped
 * to np-authority/1.1: no v1 production instrument was ever issued (trust root was never
 * populated), so no compatibility surface exists.
 *
 * SIGNED_FIELDS is retained as the documented core-field list; it no longer bounds the signature.
 */
const SIGNED_FIELDS = [
  'authority_id',
  'authority_schema_version',
  'issuer_identity',
  'subject_repository',
  'subject_ref',
  'subject_commit',
  'subject_tree',
  'candidate_tag',
  'manifest_digest',
  'population_digest',
  'policy_digest',
  'build_policy_digest',
  'allowed_workflow',
  'allowed_environment',
  'allowed_channels',
  'allowed_artifact_classes',
  'scope',
  'effective_from',
  'effective_until',
  'reviewer_identity',
  'reviewer_decision',
  'decision_timestamp',
  'decision_nonce',
  // v1.1 release-class governance fields (PILOT-CLASS amendment, NP-RELEASE-081/082):
  'release_class',
  'distribution_class',
  'public_feed_permission',
  'signing_requirement',
];

/** Every field an np-authority/1.1 object may carry. Anything else => DENY UNKNOWN_FIELD_REJECTED. */
const KNOWN_FIELDS = new Set([
  ...SIGNED_FIELDS,
  'signature',
  'signature_algorithm',
  'authority_origin',
  'real_authority',
  'production_validity',
]);

/** Release-class value contract (PILOT-CLASS governance amendment, Saurabh Patel 19/09/2026). */
const RELEASE_CLASSES = Object.freeze({
  PILOT: {
    distribution_class: 'CONTROLLED_PILOT',
    public_feed_permission: 'DENY',
    signing_requirements: ['REQUIRED', 'UNSIGNED_PILOT_EXCEPTION'],
  },
  PRODUCTION: {
    distribution_class: 'PUBLIC_PRODUCTION',
    public_feed_permission: 'ALLOW_SIGNED_ONLY',
    signing_requirements: ['REQUIRED'],
  },
});

/**
 * NP-116 (N1): the only authority_origin values, compared exactly (Contract-B, Saurabh Patel 22/09/2026).
 * Array.prototype.includes uses SameValueZero, which for strings is exact code-unit equality.
 */
const AUTHORITY_ORIGINS = Object.freeze(['FORENSIC_SYNTHETIC_ONLY', 'HUMAN_GOVERNED_AUTHORITY']);

/** JSON type name for a DENY detail. Never echoes the value itself. */
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/** Fields that must be present and non-empty (B38_AUTHORITY_OBJECT_CONTRACT §6 REQUIRED). */
const REQUIRED = [
  'authority_id',
  'authority_schema_version',
  'issuer_identity',
  'subject_repository',
  'subject_commit',
  'subject_tree',
  'manifest_digest',
  'population_digest',
  'policy_digest',
  'allowed_workflow',
  'allowed_environment',
  'scope',
  'effective_from',
  'effective_until',
  'reviewer_identity',
  'reviewer_decision',
  'decision_timestamp',
  'decision_nonce',
  'signature',
  'signature_algorithm',
  // v1.1: release-class fields are mandatory — an authority that does not state its class,
  // distribution boundary, feed permission and signing requirement is INCOMPLETE.
  'release_class',
  'distribution_class',
  'public_feed_permission',
  'signing_requirement',
  'authority_origin',
  'real_authority',
  'production_validity',
];

/**
 * v1.1 FULL-COVERAGE canonical signing bytes: every member of the object except `signature`
 * itself, canonicalised (sorted keys at every depth). Deleting, adding or altering ANY member —
 * signed-core, rehearsal marker, release-class or unknown — changes these bytes and therefore
 * invalidates the signature. This is the repair of the SIGNED_FIELDS deletion defect.
 *
 * NP-103 (signing-boundary repair). This rebuild DEFINES each own key rather than assigning it,
 * for the same reason canon() does. NP-101 repaired canon(), but this function runs one frame
 * ABOVE it and rebuilt with plain assignment, so `o.__proto__ = value` invoked the
 * Object.prototype accessor and destroyed a TOP-LEVEL own `__proto__` member before canon() ever
 * saw it: three semantically distinct objects collapsed to one signing representation and a
 * single signature covered all of them. Repairing canon() alone did not reach this path.
 * One mechanism is now used for both rebuilds, so the two cannot drift apart again.
 */
function signingBytes(a) {
  const o = {};
  for (const k of Object.keys(a)) {
    if (k !== 'signature' && a[k] !== undefined) {
      Object.defineProperty(o, k, { value: a[k], enumerable: true, writable: true, configurable: true });
    }
  }
  return Buffer.from(canon(o));
}

function admitAuthority(authority, actual, trust) {
  try {
    const a = authority;
    const x = actual;
    const t = plain(trust) ? trust : {};
    if (a === undefined || a === null) return R('DENY', 'AUTHORITY_ABSENT'); // A18: attestation without authority
    if (!plain(a)) return R('UNKNOWN', 'AUTHORITY_MALFORMED');
    if (!plain(x)) return R('UNKNOWN', 'ACTUAL_UNMEASURED');
    if (a.authority_origin === 'FORENSIC_SYNTHETIC_ONLY' && a.real_authority !== false) {
      return R('DENY', 'SYNTHETIC_MISLABELLED');
    }
    if (a.authority_schema_version !== t.schemaVersion) return R('DENY', 'SCHEMA_VERSION_UNSUPPORTED');
    // v1.1: closed field set. Any member outside the schema is rejected BEFORE signature
    // verification (defence in depth; full-coverage signing would also invalidate it).
    const unknown = Object.keys(a).filter((k) => !KNOWN_FIELDS.has(k));
    if (unknown.length) return R('DENY', 'UNKNOWN_FIELD_REJECTED', unknown);
    const missing = REQUIRED.filter((k) => a[k] === undefined || a[k] === null || a[k] === '');
    if (missing.length) return R('DENY', 'AUTHORITY_INCOMPLETE', missing);

    // ---- NP-116 (N1): authority-metadata contract. Presence alone let any non-empty value through,
    // so a validly signed "false", 0, [] or a case/whitespace variant of an origin literal reached
    // ALLOW. The signature proves who signed the object, not that its markers are well-formed, so
    // the markers are checked here, independently of the issuer and before the signature is used.
    // Exact JSON types and exact literals: no coercion, trimming, case folding or normalization.
    // A well-typed `false` passes this check; it is NOT affirmative authority, and its existing
    // synthetic handling (SYNTHETIC_MISLABELLED here, SYNTHETIC_AUTHORITY_REJECTED at the gate) is unchanged.
    if (typeof a.real_authority !== 'boolean') {
      return R('DENY', 'REAL_AUTHORITY_TYPE_INVALID', { type: jsonType(a.real_authority) });
    }
    if (typeof a.production_validity !== 'boolean') {
      return R('DENY', 'PRODUCTION_VALIDITY_TYPE_INVALID', { type: jsonType(a.production_validity) });
    }
    if (typeof a.authority_origin !== 'string' || !AUTHORITY_ORIGINS.includes(a.authority_origin)) {
      return R('DENY', 'AUTHORITY_ORIGIN_INVALID', { type: jsonType(a.authority_origin) });
    }

    // ---- v1.1 release-class governance (PILOT-CLASS amendment): the class and its boundary
    // fields are signed (full coverage) and validated against a fixed value contract, so a
    // signed PILOT authority cannot be mutated into PRODUCTION, into public-feed permission,
    // or into an unbounded distribution without invalidating the signature — and even a
    // freshly-signed object with inconsistent class fields is DENIED here.
    const rc = RELEASE_CLASSES[a.release_class];
    if (!rc) return R('DENY', 'RELEASE_CLASS_INVALID', a.release_class);
    if (t.releaseClass !== undefined && t.releaseClass !== null && a.release_class !== t.releaseClass) {
      return R('DENY', 'RELEASE_CLASS_MISMATCH', { authority: a.release_class, trust: t.releaseClass });
    }
    if (a.distribution_class !== rc.distribution_class) {
      return R('DENY', a.release_class === 'PILOT' ? 'PILOT_DISTRIBUTION_UNBOUNDED' : 'DISTRIBUTION_CLASS_INVALID');
    }
    if (a.public_feed_permission !== rc.public_feed_permission) {
      return R('DENY', a.release_class === 'PILOT' ? 'PILOT_PUBLIC_FEED_FORBIDDEN' : 'FEED_PERMISSION_INVALID');
    }
    if (!rc.signing_requirements.includes(a.signing_requirement)) {
      return R(
        'DENY',
        a.release_class === 'PRODUCTION' && a.signing_requirement !== 'REQUIRED'
          ? 'UNSIGNED_PRODUCTION_FORBIDDEN'
          : 'SIGNING_REQUIREMENT_INVALID',
      );
    }

    // ---- issuer independence: trust list held outside the subject; issuer ∉ subject principals ----
    if (!Array.isArray(t.trustedIssuers) || !t.trustedIssuers.includes(a.issuer_identity)) {
      return R('DENY', 'ISSUER_UNTRUSTED');
    }
    const subjectPrincipals = new Set(
      [x.run && x.run.initiator, x.run && x.run.tag_pusher, x.run && x.run.workflow_author].filter(Boolean),
    );
    if (subjectPrincipals.has(a.issuer_identity)) return R('DENY', 'ISSUER_IS_SUBJECT'); // circular authority
    if (a.issuer_identity === a.reviewer_identity) return R('DENY', 'ISSUER_IS_REVIEWER');

    // ---- signature: algorithm fixed by verifier; key held outside the subject; verifies over canonical signed fields ----
    if (a.signature_algorithm !== t.signatureAlgorithm) return R('DENY', 'SIGNATURE_ALGORITHM_REJECTED');
    if (typeof t.verifySignature !== 'function') return R('UNKNOWN', 'VERIFIER_UNAVAILABLE');
    if (t.verifySignature(a.issuer_identity, signingBytes(a), a.signature) !== true) {
      return R('DENY', 'SIGNATURE_INVALID'); // A17 subject-generated signature
    }

    // ---- subject binding: every identity compared to a MEASUREMENT ----
    if (a.subject_repository !== x.repository_id) return R('DENY', 'REPOSITORY_MISMATCH');
    if (
      !x.candidate ||
      !hex40(x.candidate.commit) ||
      !hex40(x.candidate.tree) ||
      x.candidate.measured_from !== 'git_objects'
    ) {
      return R('UNKNOWN', 'CANDIDATE_UNMEASURED');
    }
    if (a.subject_ref !== undefined && a.subject_ref !== x.candidate.ref) return R('DENY', 'REF_MISMATCH');
    if (a.candidate_tag !== undefined && a.candidate_tag !== x.candidate.tag) return R('DENY', 'TAG_MISMATCH');
    if (a.subject_commit !== x.candidate.commit) return R('DENY', 'COMMIT_MISMATCH'); // A01/A02/A12
    if (a.subject_tree !== x.candidate.tree) return R('DENY', 'TREE_MISMATCH'); // A03/A13
    if (!Buffer.isBuffer(x.manifest_bytes) || a.manifest_digest !== H(x.manifest_bytes)) {
      return R('DENY', 'MANIFEST_MISMATCH'); // A04/A14
    }
    if (!Array.isArray(x.population) || a.population_digest !== H(Buffer.from(canon(x.population)))) {
      return R('DENY', 'POPULATION_MISMATCH'); // A05/A15
    }
    if (!plain(x.policy) || a.policy_digest !== H(Buffer.from(canon(x.policy)))) {
      return R('DENY', 'POLICY_MISMATCH'); // A06/A15
    }
    if (
      a.build_policy_digest !== undefined &&
      (!plain(x.build_policy) || a.build_policy_digest !== H(Buffer.from(canon(x.build_policy))))
    ) {
      return R('DENY', 'BUILD_POLICY_MISMATCH');
    }
    if (!x.run || a.allowed_workflow !== x.run.workflow_ref) return R('DENY', 'WORKFLOW_MISMATCH'); // A07
    if (a.scope !== t.scope) return R('DENY', 'SCOPE_MISMATCH');

    // ---- temporal validity + replay ----
    const from = Date.parse(a.effective_from);
    const until = Date.parse(a.effective_until);
    const dec = Date.parse(a.decision_timestamp);
    if (![from, until, dec].every(Number.isFinite)) return R('DENY', 'TEMPORAL_FIELDS_MALFORMED');
    const tAdm = Number.isFinite(x.admission_time) ? x.admission_time : NaN;
    const tDep = Number.isFinite(x.deployment_time) ? x.deployment_time : tAdm;
    if (!Number.isFinite(tAdm)) return R('UNKNOWN', 'ADMISSION_TIME_UNMEASURED');
    if (dec > tAdm) return R('DENY', 'DECISION_AFTER_ADMISSION');
    if (tAdm < from || tAdm > until) return R('DENY', 'AUTHORITY_NOT_VALID_AT_ADMISSION'); // A08
    if (t.deploymentTimeValidity !== false && (tDep < from || tDep > until)) {
      return R('DENY', 'AUTHORITY_EXPIRED_BEFORE_DEPLOYMENT'); // A09 (contract: deployment-time validity required)
    }
    if (typeof a.decision_nonce !== 'string' || a.decision_nonce.length < 16) return R('DENY', 'NONCE_WEAK');
    if (Array.isArray(t.consumedNonces) && t.consumedNonces.includes(a.decision_nonce)) {
      return R('DENY', 'AUTHORITY_REPLAYED');
    }

    // ---- reviewer: decision, identity from the platform's review record (not from the object alone), separation ----
    if (a.reviewer_decision !== 'approved') return R('DENY', 'REVIEWER_NOT_APPROVED');
    const rv = x.review;
    if (!plain(rv) || rv.source !== 'deployment_review_api' || rv.captured_by_verifier !== true) {
      return R('UNKNOWN', 'REVIEW_RECORD_UNCAPTURED');
    }
    if (rv.approver !== a.reviewer_identity) return R('DENY', 'REVIEWER_IDENTITY_MISMATCH'); // A16
    if (subjectPrincipals.has(rv.approver)) return R('DENY', 'REVIEWER_IS_SUBJECT'); // separation
    if (rv.run_id !== x.run.run_id || rv.run_attempt !== x.run.run_attempt) return R('DENY', 'REVIEW_RUN_MISMATCH');
    if (rv.approved_subject_digest !== H(signingBytes(a))) {
      return R('DENY', 'REVIEW_NOT_BOUND_TO_AUTHORITY_SUBJECT'); // A20: approval exists but subject not bound
    }
    if (Array.isArray(t.allowedReviewers) && !t.allowedReviewers.includes(rv.approver)) {
      return R('DENY', 'REVIEWER_NOT_ALLOWED');
    }

    // ---- environment: name in authority must be a PROTECTED environment, captured independently ----
    const env = x.environment;
    if (!plain(env) || env.source !== 'admin_api_capture' || env.captured_by_verifier !== true) {
      return R('UNKNOWN', 'ENVIRONMENT_UNCAPTURED');
    }
    if (env.name !== a.allowed_environment) return R('DENY', 'ENVIRONMENT_MISMATCH');
    if (env.exists !== true) return R('DENY', 'ENVIRONMENT_ABSENT'); // A19
    if (env.required_reviewers !== true || env.prevent_self_review !== true) {
      return R('DENY', 'ENVIRONMENT_UNPROTECTED');
    }
    if (t.tagPattern && env.deployment_tag_pattern !== t.tagPattern) {
      return R('DENY', 'ENVIRONMENT_TAG_POLICY_MISMATCH');
    }
    return R('ALLOW', 'AUTHORITY_ADMITTED', { authority_subject_digest: H(signingBytes(a)) });
  } catch (e) {
    return R('UNKNOWN', 'EXCEPTION', String((e && e.message) || e).slice(0, 120));
  }
}

// downstream relation: an artifact attestation is provenance; it becomes AUTHORIZATION only if its subject set
// includes the admitted authority's digest
function attestationAuthorizes(verification, admitted, artifact) {
  try {
    if (!plain(admitted) || admitted.verdict !== 'ALLOW') return R('DENY', 'NO_ADMITTED_AUTHORITY'); // A18
    if (verification === undefined || verification === null) return R('UNKNOWN', 'ATTESTATION_ABSENT');
    if (!plain(verification) || verification.verified !== true || verification.source === 'artifact_metadata') {
      return R('DENY', 'ATTESTATION_INVALID');
    }
    if (!plain(artifact) || !Buffer.isBuffer(artifact.bytes)) return R('UNKNOWN', 'ARTIFACT_UNMEASURED');
    if (!Array.isArray(verification.subjects) || !verification.subjects.includes(H(artifact.bytes))) {
      return R('DENY', 'ATTESTATION_SUBJECT_MISMATCH'); // A10
    }
    if (!verification.subjects.includes(admitted.detail.authority_subject_digest)) {
      return R('DENY', 'ATTESTATION_DOES_NOT_BIND_AUTHORITY'); // A11 / §9 condition
    }
    if (verification.commit !== undefined && verification.commit !== artifact.commit) {
      return R('DENY', 'ATTESTATION_COMMIT_MISMATCH');
    }
    return R('ALLOW', 'ATTESTATION_BOUND_TO_AUTHORITY');
  } catch (e) {
    return R('UNKNOWN', 'EXCEPTION', String((e && e.message) || e).slice(0, 120));
  }
}

module.exports = {
  admitAuthority,
  attestationAuthorizes,
  signingBytes,
  canon,
  H,
  SIGNED_FIELDS,
  KNOWN_FIELDS,
  RELEASE_CLASSES,
  REQUIRED,
  hex40,
  hex64,
  plain,
};
