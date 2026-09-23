import { describe, expect, it } from 'vitest';
import {
  evaluateBootstrap, parseBindingInstrument, BINDING_INSTRUMENT_PREFIX, type BootstrapRequest,
} from './authorityBootstrap';
import type { AuthorityDecisionArtifact, RoleBinding } from './authorityEvaluator';

/* ENG-11 — the governed write path. Positive and negative paths, per the directive's §5 list. */

const NOW = new Date('2026-09-24T00:00:00.000Z');
const ADMIN = '11111111-1111-4111-8111-111111111111';   // H2, performs the write
const SUBJ = '22222222-2222-4222-8222-222222222222';    // H1, the authority subject
const OTHER = '33333333-3333-4333-8333-333333333333';
const ROLE = 'FIRST_PILOT_HUMAN_DECISION_AUTHORITY';
const inst = (s: string, r: string) => `${BINDING_INSTRUMENT_PREFIX}:${s}:${r}`;

const artifact = (over: Partial<AuthorityDecisionArtifact> = {}): AuthorityDecisionArtifact => ({
  instrument: inst(SUBJ, ROLE), authenticated: true, actions: ['pilot.stop'],
  environmentClass: 'PILOT', effectiveFrom: '2026-09-01T00:00:00.000Z',
  expiresAt: null, revokedAt: null, ...over,
});
const req = (over: Partial<BootstrapRequest> = {}): BootstrapRequest =>
  ({ actorId: ADMIN, subjectId: SUBJ, role: ROLE, instrument: inst(SUBJ, ROLE), ...over });
const run = (r = req(), adm: AuthorityDecisionArtifact[] = [artifact()], ex: RoleBinding[] = []) =>
  evaluateBootstrap(r, adm, ex, NOW);
const binding = (over: Partial<RoleBinding> = {}): RoleBinding => ({
  subjectId: SUBJ, role: ROLE as RoleBinding['role'], decisionRef: inst(SUBJ, ROLE),
  boundAt: '2026-09-01T00:00:00.000Z', expiresAt: null, revokedAt: null, ...over,
});

describe('ENG-11 bootstrap — positive path', () => {
  it('a legitimate bootstrap succeeds', () => {
    expect(run()).toEqual({ ok: true });
  });
  it('the instrument name binds subject and role cryptographically', () => {
    expect(parseBindingInstrument(inst(SUBJ, ROLE))).toEqual({ subjectId: SUBJ, role: ROLE });
  });
});

describe('ENG-11 bootstrap — every negative path the directive names', () => {
  it('SELF-ASSIGNMENT is denied', () => {
    expect(run(req({ actorId: SUBJ }))).toEqual({ ok: false, reason: 'SELF_ASSIGNMENT_DENIED' });
  });
  it('the administrator cannot assign authority to themselves', () => {
    // The C1 residual-risk acceptance depends on exactly this.
    const r = req({ actorId: ADMIN, subjectId: ADMIN, instrument: inst(ADMIN, ROLE) });
    expect(run(r, [artifact({ instrument: inst(ADMIN, ROLE) })]))
      .toEqual({ ok: false, reason: 'SELF_ASSIGNMENT_DENIED' });
  });
  it('self-assignment is refused BEFORE the instrument is consulted — no probing', () => {
    // Empty admitted list: if the instrument were checked first this would say NOT_ADMITTED.
    expect(run(req({ actorId: SUBJ }), [])).toEqual({ ok: false, reason: 'SELF_ASSIGNMENT_DENIED' });
  });

  it('an unsigned / unadmitted instrument is denied', () => {
    expect(run(req(), [])).toEqual({ ok: false, reason: 'INSTRUMENT_NOT_ADMITTED' });
  });
  it('an instrument naming a DIFFERENT subject is denied — the signature wins', () => {
    const r = req({ subjectId: OTHER });
    expect(run(r, [artifact()])).toEqual({ ok: false, reason: 'INSTRUMENT_SUBJECT_MISMATCH' });
  });
  it('an instrument naming a different ROLE is denied', () => {
    const r = req({ instrument: inst(SUBJ, 'INDEPENDENT_PILOT_VERIFIER') });
    expect(run(r, [artifact({ instrument: inst(SUBJ, 'INDEPENDENT_PILOT_VERIFIER') })]))
      .toEqual({ ok: false, reason: 'INSTRUMENT_ROLE_MISMATCH' });
  });
  it('an unauthenticated instrument is denied', () => {
    expect(run(req(), [artifact({ authenticated: false })]))
      .toEqual({ ok: false, reason: 'INSTRUMENT_NOT_AUTHENTICATED' });
  });
  it('a non-PILOT instrument is denied', () => {
    expect(run(req(), [artifact({ environmentClass: 'PRODUCTION' })]))
      .toEqual({ ok: false, reason: 'INSTRUMENT_OUT_OF_SCOPE' });
  });
  it('a revoked instrument is denied', () => {
    expect(run(req(), [artifact({ revokedAt: '2026-09-02T00:00:00.000Z' })]))
      .toEqual({ ok: false, reason: 'INSTRUMENT_NOT_IN_FORCE' });
  });
  it('a not-yet-effective instrument is denied', () => {
    expect(run(req(), [artifact({ effectiveFrom: '2099-01-01T00:00:00.000Z' })]))
      .toEqual({ ok: false, reason: 'INSTRUMENT_NOT_IN_FORCE' });
  });
  it('an expired instrument is denied', () => {
    expect(run(req(), [artifact({ expiresAt: '2026-09-02T00:00:00.000Z' })]))
      .toEqual({ ok: false, reason: 'INSTRUMENT_NOT_IN_FORCE' });
  });

  it('an unknown role is denied', () => {
    expect(run(req({ role: 'SUPER_ADMIN', instrument: inst(SUBJ, 'SUPER_ADMIN') })))
      .toEqual({ ok: false, reason: 'UNKNOWN_ROLE' });
  });
  it('a malformed subject is denied', () => {
    expect(run(req({ subjectId: 'not-a-uuid' }))).toEqual({ ok: false, reason: 'SUBJECT_MALFORMED' });
  });
  it('a malformed instrument is denied', () => {
    expect(run(req({ instrument: 'NP-PILOT-BIND' }))).toEqual({ ok: false, reason: 'INSTRUMENT_MALFORMED' });
    expect(run(req({ instrument: 'WRONG:x:y' }))).toEqual({ ok: false, reason: 'INSTRUMENT_MALFORMED' });
  });

  it('a duplicate active binding is denied', () => {
    expect(run(req(), [artifact()], [binding()])).toEqual({ ok: false, reason: 'DUPLICATE_BINDING' });
  });
  it('a conflicting role for the same subject is denied — separation of duty', () => {
    const other = binding({ role: 'PILOT_OPERATOR_TECHNICAL_OPERATIONS' as RoleBinding['role'] });
    expect(run(req(), [artifact()], [other])).toEqual({ ok: false, reason: 'CONFLICTING_BINDING' });
  });
  it('a REVOKED prior binding does not block a fresh one', () => {
    const dead = binding({ revokedAt: '2026-09-02T00:00:00.000Z' });
    expect(run(req(), [artifact()], [dead])).toEqual({ ok: true });
  });
  it('an EXPIRED prior binding does not block a fresh one', () => {
    const dead = binding({ expiresAt: '2026-09-02T00:00:00.000Z' });
    expect(run(req(), [artifact()], [dead])).toEqual({ ok: true });
  });
  it('another subject holding the same role does not block this one', () => {
    expect(run(req(), [artifact()], [binding({ subjectId: OTHER })])).toEqual({ ok: true });
  });
});

describe('ENG-11 — the role vocabulary is derived, not mirrored', () => {
  it('rejects a role that is not in the real ROLE_ACTIONS matrix', () => {
    expect(run(req({ role: 'PILOT_OPERATOR', instrument: inst(SUBJ, 'PILOT_OPERATOR') })))
      .toEqual({ ok: false, reason: 'UNKNOWN_ROLE' });
  });
  it('accepts every role the matrix actually declares', () => {
    for (const r of ['PILOT_OPERATOR_TECHNICAL_OPERATIONS', 'INDEPENDENT_PILOT_VERIFIER']) {
      const q = req({ role: r, instrument: inst(SUBJ, r) });
      expect(run(q, [artifact({ instrument: inst(SUBJ, r) })])).toEqual({ ok: true });
    }
  });
});
