/**
 * What actually happened after the action.
 *
 * The layout is the argument. Three columns — EXPECTED, MEASURED, VERIFIED —
 * because the failure this screen exists to prevent is a reader collapsing
 * them into one. "We hoped the price would fall", "the price we then paid was
 * X", and "we checked that X came from records that add up" are three
 * different claims with three different strengths, and a design that stacks
 * them as one narrative invites the reader to treat the weakest as the
 * strongest.
 *
 * Three more rules, each a thing the tempting version gets wrong:
 *
 *  - **A worse result is displayed exactly as prominently as a better one**,
 *    in the same place, in the same size, in the same colour. Neither
 *    direction gets a verdict tone — see `DIRECTION_TONE`.
 *  - **The causal sentence is not a footnote.** It sits directly under the
 *    number, because the number's most natural misreading is "we did that".
 *  - **Refresh re-derives.** There is no cache between this and the records,
 *    so pressing it cannot be a no-op.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Outcome } from '@neuropause/shared';
import {
  OUTCOME_CONFIDENCE_LABELS,
  OUTCOME_DIRECTION_LABELS,
  OUTCOME_STATUS_LABELS,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import { SkeletonCards, SkeletonRegion } from '@renderer/components/ui/Skeleton';

const log = createLogger('outcome');

const STATUS_TONE: Record<string, string> = {
  verified: 'border-sysgreen/40 text-sysgreen',
  measured: 'border-sysblue/40 text-sysblue',
  failed_to_verify: 'border-sysorange/40 text-sysorange',
  pending: 'border-[var(--hairline)] text-faint',
  unavailable: 'border-[var(--hairline)] text-faint',
};

/**
 * Neither direction gets a verdict colour.
 *
 * Amber for a rise would read as an error — the price going up is a finding,
 * not a fault. Green for a fall is worse: it is the product's approval colour,
 * applied to a number whose causality it has just finished disclaiming, often
 * on an order where no money has moved. The words carry the direction; the
 * colour is reserved for the VERIFIED badge, which is the only thing here that
 * has actually been checked.
 */
const DIRECTION_TONE: Record<string, string> = {
  favourable: 'text-[var(--text)]',
  unfavourable: 'text-[var(--text)]',
  unchanged: 'text-muted',
  unknown: 'text-faint',
};

function money(value: number, currency: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function signed(value: number, currency: string): string {
  return `${value > 0 ? '+' : ''}${money(value, currency)}`;
}

export function OutcomeSection({
  opportunityId,
  /**
   * Bumped by the parent whenever the opportunity itself changed.
   *
   * Without it this panel stays mounted across a reload and keeps asserting
   * "no action has been run" while the RFQ it is asking about sits in the
   * store — the measurement equivalent of a stale finding.
   */
  revision,
}: {
  opportunityId: string;
  revision: string;
}): JSX.Element {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setOutcome(await ipc.opportunities.outcome(opportunityId));
    } catch (err) {
      log.warn('Outcome unavailable', { message: String(err) });
      setOutcome(null);
      setError('The measurement could not be loaded. This is a fault, not a result.');
    } finally {
      setBusy(false);
      setSettled(true);
    }
  }, [opportunityId]);

  // `revision` belongs on the EFFECT, not on `load`: the measurement is the
  // same operation either way, but it must be run again when the opportunity
  // beneath this panel moves.
  useEffect(() => {
    void load();
  }, [load, revision]);

  if (!settled) {
    return (
      <SkeletonRegion label="Measuring the outcome">
        <SkeletonCards count={1} lines={2} />
      </SkeletonRegion>
    );
  }

  const measurable = outcome !== null && outcome.change !== null;

  return (
    <div className="rounded-xl border border-[var(--hairline)] px-3.5 py-3">
      {/*
        The header — and with it the only retry affordance — renders in every
        state. An earlier version returned early on error, which left a failed
        load as a dead end until the user collapsed and re-opened the card.
      */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-faint">Outcome</span>
          {outcome && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[outcome.status] ?? STATUS_TONE.unavailable}`}
            >
              <Icon name={outcome.status === 'verified' ? 'verified' : 'info'} size={10} />
              {OUTCOME_STATUS_LABELS[outcome.status]}
            </span>
          )}
        </div>
        <Button size="sm" icon="refresh" onClick={() => void load()} loading={busy}>
          Refresh measurement
        </Button>
      </div>

      {error && <NoticeBlock icon="info">{error}</NoticeBlock>}
      {!outcome && !error && (
        <NoticeBlock icon="info">No measurement exists for this finding.</NoticeBlock>
      )}
      {outcome && (
        <>
          {/*
        Three columns, always in this order, even when the middle one is empty.
        Keeping the frame visible when there is nothing to measure is what
        stops "no measurement" reading as "no expectation either".
      */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Column label="Expected" tone="text-muted">
              <p className="text-sm leading-relaxed text-muted">{outcome.expectedEffect}</p>
              <p className="mt-1 text-[11px] text-faint">
                What the plan set out to do. Not a prediction, and not a promise.
              </p>
            </Column>

            <Column label="Measured" tone="text-muted">
              {measurable ? (
                <>
                  <div
                    className={`text-lg font-semibold tabular-nums ${DIRECTION_TONE[outcome.direction]}`}
                  >
                    {signed(outcome.change as number, outcome.currency)}
                  </div>
                  <div className="text-[11px] leading-tight text-faint">
                    per unit
                    {outcome.changePercent !== null &&
                      ` · ${outcome.changePercent > 0 ? '+' : ''}${outcome.changePercent}%`}
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {OUTCOME_DIRECTION_LABELS[outcome.direction]}
                  </p>
                </>
              ) : (
                <p className="text-sm leading-relaxed text-faint">
                  Nothing measured. See below for why.
                </p>
              )}
            </Column>

            <Column label="Verified" tone="text-muted">
              {outcome.verification.length === 0 ? (
                <p className="text-sm leading-relaxed text-faint">
                  Verification has not run — there is no measurement to verify.
                </p>
              ) : (
                <>
                  <div className="text-sm font-medium">
                    {outcome.verification.filter((c) => c.passed).length} of{' '}
                    {outcome.verification.length} checks passed
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Confidence: {OUTCOME_CONFIDENCE_LABELS[outcome.confidence.tier]}
                  </p>
                </>
              )}
            </Column>
          </div>

          {/*
        Directly under the number, not in small print at the bottom. The most
        natural misreading of any change is "we caused that".
      */}
          {measurable && (
            <p className="mt-3 rounded-lg border border-[var(--hairline)] px-3 py-2 text-sm leading-relaxed text-muted">
              <Icon name="info" size={12} className="mr-1 inline text-faint" />
              {outcome.causalNote}
            </p>
          )}

          {outcome.blocked && (
            <div className="mt-3 space-y-2">
              <p className="text-sm leading-relaxed">{outcome.blocked.headline}</p>
              <Facts label="What is available" items={outcome.blocked.available} />
              <Facts label="What is missing" items={outcome.blocked.missing} />
              <Facts
                label="What would enable the measurement"
                items={outcome.blocked.wouldEnable}
              />
            </div>
          )}

          {measurable && (
            <>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                <Fact
                  label="Baseline"
                  value={
                    outcome.baseline.value === null
                      ? 'Not established.'
                      : `${money(outcome.baseline.value, outcome.currency)} ${outcome.baseline.unit} — ${outcome.baseline.method}`
                  }
                />
                <Fact
                  label="Measured"
                  value={
                    outcome.measurement.value === null
                      ? 'Not established.'
                      : `${money(outcome.measurement.value, outcome.currency)} ${outcome.measurement.unit} — ${outcome.measurement.method}`
                  }
                />
                {outcome.baseline.period && (
                  <Fact
                    label="Baseline period"
                    value={`${outcome.baseline.period.fromIso.slice(0, 10)} to ${outcome.baseline.period.toIso.slice(0, 10)} (${outcome.baseline.period.days} days)`}
                  />
                )}
                {outcome.measurement.period && (
                  <Fact
                    label="Measurement period"
                    value={`${outcome.measurement.period.fromIso.slice(0, 10)} to ${outcome.measurement.period.toIso.slice(0, 10)} (${outcome.measurement.period.days} days)`}
                  />
                )}
              </dl>

              {outcome.financialEffect ? (
                <div className="mt-3 rounded-lg border border-[var(--hairline)] px-3 py-2">
                  <div className="text-xs uppercase tracking-wider text-faint">
                    Financial effect
                  </div>
                  <div
                    className={`mt-0.5 text-base font-semibold tabular-nums ${DIRECTION_TONE[outcome.direction]}`}
                  >
                    {signed(outcome.financialEffect.amount, outcome.financialEffect.currency)}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {outcome.financialEffect.basis}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {outcome.financialEffect.caveat}
                  </p>
                </div>
              ) : (
                outcome.financialEffectUnavailable && (
                  <div className="mt-3">
                    <Fact label="Financial effect" value={outcome.financialEffectUnavailable} />
                  </div>
                )
              )}

              <div className="mt-3">
                <div className="text-xs uppercase tracking-wider text-faint">Verification</div>
                <ul className="mt-1.5 space-y-1.5">
                  {outcome.verification.map((check) => (
                    <li key={check.id} className="flex gap-2 text-sm leading-relaxed">
                      <Icon
                        name={check.passed ? 'check' : 'close'}
                        size={12}
                        className={check.passed ? 'mt-1 text-sysgreen' : 'mt-1 text-sysorange'}
                      />
                      <span className="text-muted">
                        <span className="font-medium text-[var(--text)]">{check.label}.</span>{' '}
                        {check.detail}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-sm text-muted">{outcome.confidence.basis}</p>
              </div>
            </>
          )}

          {(outcome.baseline.records.length > 0 || outcome.measurement.records.length > 0) && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wider text-faint">Source records</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[...outcome.baseline.records, ...outcome.measurement.records].map((record) => (
                  <span
                    key={`${record.moduleId}/${record.recordId}`}
                    className="rounded-md border border-[var(--hairline)] px-1.5 py-0.5 text-[11px] text-faint"
                  >
                    {record.label}
                  </span>
                ))}
                {outcome.execution && (
                  <span className="rounded-md border border-[var(--hairline)] px-1.5 py-0.5 text-[11px] text-faint">
                    {outcome.execution.label} (the action)
                  </span>
                )}
              </div>
            </div>
          )}

          {/*
        Only when something WAS measured. On a blocked outcome the unknowns are
        the same sentences already shown under "What is missing", and printing
        them twice makes the section look padded rather than careful.
      */}
          {!outcome.blocked && outcome.unknown.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wider text-faint">
                What this measurement cannot establish
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {outcome.unknown.map((line) => (
                  <li key={line} className="flex gap-2 text-sm leading-relaxed text-muted">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--hairline)]" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outcome.revisions.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wider text-faint">
                Recorded measurements ({outcome.revisions.length})
              </div>
              <ul className="mt-1.5 space-y-1">
                {outcome.revisions.map((revision) => (
                  <li key={revision.id} className="text-sm text-muted">
                    <span className="tabular-nums text-faint">
                      {new Date(revision.at).toLocaleString()}
                    </span>{' '}
                    —{' '}
                    {revision.measurement === null
                      ? 'no measurement'
                      : money(revision.measurement, revision.currency)}
                    {revision.actor && ` · ${revision.actor}`}
                    <span className="block text-[11px] text-faint">{revision.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-xs text-faint">
            Measured at {new Date(outcome.measuredAt).toLocaleString()} from the records as they are
            now. Nothing here is cached — Refresh recomputes it.
            {outcome.decisionId && ` Decision Record ${outcome.decisionId}.`}
          </p>
        </>
      )}
    </div>
  );
}

function Column({
  label,
  tone,
  children,
}: {
  label: string;
  tone: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-[var(--hairline)] px-3 py-2.5">
      <div className={`mb-1 text-xs uppercase tracking-wider text-faint ${tone}`}>{label}</div>
      {children}
    </div>
  );
}

function Facts({ label, items }: { label: string; items: readonly string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-faint">{label}</div>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-muted">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--hairline)]" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="text-sm leading-relaxed text-muted">{value}</dd>
    </div>
  );
}
