/**
 * The Opportunity Center — what NeuroPause found in your own records.
 *
 * The hardest screen in the product to get right, because the tempting version
 * is easy: five confident cards with big currency figures and a percentage. The
 * honest version has to survive three situations the tempting one ignores.
 *
 *  1. **Nothing found, which on a fresh install is always.** An empty list is
 *     indistinguishable from a broken analysis, so the empty state carries the
 *     data review: how many orders were examined, exactly why each one was set
 *     aside, and what would let NeuroPause say more. That is the screen most
 *     users will see first, so it is written as a real answer, not a shrug.
 *
 *  2. **A number that could be misread.** The impact figure is money ALREADY
 *     SPENT above the lowest price you paid — not a saving on offer. It is
 *     never shown without that sentence next to it, because a figure people
 *     misremember as "savings available" is worse than no figure.
 *
 *  3. **A finding that might be wrong.** Every card carries what NeuroPause
 *     cannot establish, at the same visual weight as what it can. The "what we
 *     don't know" block is not a disclaimer in small print; it is one of the
 *     four things the detail view is for.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type {
  HoldRecord,
  Opportunity,
  OpportunityCenterView,
  OpportunityStatus,
} from '@neuropause/shared';
import {
  CONFIDENCE_LABELS,
  HOLD_REASON_LABELS,
  OPPORTUNITY_CATEGORY_LABELS,
  OPPORTUNITY_STATUS_LABELS,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { Button } from '@renderer/components/ui/Button';
import { Card } from '@renderer/components/ui/Card';
import { Icon } from '@renderer/components/ui/Icon';
import { NoticeBlock } from '@renderer/dataCommandCenter/primitives';
import { SkeletonCards, SkeletonRegion } from '@renderer/components/ui/Skeleton';
import { TRANSITION, listItemVariants, staggerDelay } from '@renderer/lib/motion';
import { useAnimatedCount } from '@renderer/lib/useAnimatedCount';
import { OutcomeSection } from './OutcomeSection';

const log = createLogger('opportunities');

/** Confidence tone. Weak is grey, not red — low confidence is not an alarm. */
const CONFIDENCE_TONE: Record<string, string> = {
  strong: 'border-sysgreen/40 text-sysgreen',
  moderate: 'border-sysblue/40 text-sysblue',
  weak: 'border-[var(--hairline)] text-faint',
};

function money(amount: number, currency: string): string {
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function OpportunitiesView(): JSX.Element {
  const [view, setView] = useState<OpportunityCenterView | null>(null);
  /**
   * Whether a load has finished, successfully or not.
   *
   * Explicit rather than inferred from `view === null`: a failed load also
   * leaves `view` null, and inferring left the screen showing a loading
   * skeleton forever with the error banner never reachable underneath it.
   */
  const [settled, setSettled] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldRecord | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  /**
   * Whether the last action actually succeeded.
   *
   * Separate from `hold` because there is a third case: a refusal with no hold
   * (an RFQ is already open). Deriving the icon from `hold === null` put a
   * green tick on that message — the product congratulating itself for
   * declining.
   */
  const [succeeded, setSucceeded] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    // Banners describe the LAST action. Carrying one across a reload lets a
    // hold raised for card A sit above card B, reading as if it applies there.
    setHold(null);
    setOutcome(null);
    setError(null);
    try {
      setView(await ipc.opportunities.list());
      setDenied(false);
    } catch (err) {
      // Two different failures, and the difference matters: RBAC doing its job
      // is not a bug, but a store fault is — and telling someone "you do not
      // hold procurement:read" when the real cause was a crash is a confident
      // false claim about their account.
      const message = String(err);
      log.warn('Opportunities unavailable', { message });
      setDenied(/not authori|permission|procurement:read|Sign in/i.test(message));
      setError(
        /not authori|permission|procurement:read|Sign in/i.test(message)
          ? null
          : 'Opportunities could not be loaded. This is a fault, not a permission problem — nothing about your records has changed.',
      );
      // Never leave a stale finding list under a failure banner.
      setView(null);
    } finally {
      setSettled(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const decide = async (
    opportunity: Opportunity,
    status: OpportunityStatus,
    note?: string,
  ): Promise<void> => {
    setBusy(opportunity.id);
    setError(null);
    try {
      const updated = await ipc.opportunities.setStatus(opportunity.id, status, note);
      await reload();
      // AFTER the reload, which clears banners. The handler refuses `measured`
      // when no real measurement exists, and a button that silently does
      // nothing is worse than one that explains.
      if (status === 'measured' && updated && updated.status !== 'measured') {
        setError(
          'There is no measurement to record yet — the outcome below says what is still missing.',
        );
      }
    } catch (err) {
      log.warn('Could not record the decision', { message: String(err) });
      setError('That could not be recorded — you may not hold procurement:manage.');
    } finally {
      setBusy(null);
    }
  };

  const run = async (opportunity: Opportunity): Promise<void> => {
    setBusy(opportunity.id);
    setError(null);
    setHold(null);
    setOutcome(null);
    try {
      const result = await ipc.opportunities.execute(opportunity.id);
      await reload(); // clears the previous banners first
      // A refusal here is governance, not failure. The hold IS the answer, so
      // it is rendered in full rather than flattened into an error string.
      setHold(result.hold);
      setOutcome(result.message);
      setSucceeded(result.ok);
    } catch (err) {
      log.warn('Could not run the plan', { message: String(err) });
      setError('The plan could not be run. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  };

  const found = view?.opportunities ?? [];
  const foundCount = useAnimatedCount(found.length);

  if (!settled) {
    return (
      <ViewScroll max={920}>
        <ViewHeader
          title="Opportunities"
          subtitle="What NeuroPause found in your own records — and what it cannot establish."
        />
        <SkeletonRegion label="Looking through your records">
          <SkeletonCards count={2} lines={3} />
        </SkeletonRegion>
      </ViewScroll>
    );
  }

  return (
    <ViewScroll max={920}>
      <ViewHeader
        title="Opportunities"
        subtitle="Findings derived from your own business records. Every figure here is arithmetic over orders you can open — nothing is estimated, projected or benchmarked."
        right={
          <Button icon="refresh" onClick={() => void reload()}>
            Refresh
          </Button>
        }
      />

      {denied && (
        <NoticeBlock icon="shield">
          You do not hold procurement:read, so this surface cannot show you findings derived from
          purchase orders. Nothing is being hidden — it simply cannot be displayed to this account.
        </NoticeBlock>
      )}
      {error && (
        <div className="mb-4">
          <NoticeBlock icon="info">{error}</NoticeBlock>
        </div>
      )}

      {outcome && (
        <div className="mb-4">
          <NoticeBlock icon={succeeded ? 'check' : hold ? 'shield' : 'info'}>{outcome}</NoticeBlock>
        </div>
      )}
      {hold && (
        <Card variant="hairline" className="mb-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-sysorange/40 px-2 py-0.5 text-[11px] font-medium text-sysorange">
              <Icon name="info" size={10} />
              On hold · {HOLD_REASON_LABELS[hold.reason]}
            </span>
          </div>
          <h3 className="mt-1.5 text-base font-semibold">{hold.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">{hold.why}</p>
          <div className="mt-3 rounded-xl border border-[var(--hairline)] px-3.5 py-2.5">
            <div className="text-xs uppercase tracking-wider text-faint">
              What would resolve this
            </div>
            <p className="mt-1 text-sm text-muted">{hold.resolution}</p>
          </div>
          <p className="mt-2 text-xs text-faint">
            This is in Holds, with its Decision Record, until someone resolves it.
          </p>
        </Card>
      )}

      {view && (
        <>
          <section className="mb-8">
            <h2 className="mb-2.5 text-sm font-semibold">
              What NeuroPause found
              {found.length > 0 && <span className="ml-1.5 text-faint">{foundCount}</span>}
            </h2>

            {view.insufficient ? (
              <InsufficientState view={view} />
            ) : found.length === 0 ? (
              <NoticeBlock icon="check">
                Every finding has been dismissed. They are listed below with what they were worth
                when you set them aside.
              </NoticeBlock>
            ) : (
              <div className="space-y-3">
                <AnimatePresence initial={false} mode="popLayout">
                  {found.map((opportunity, i) => (
                    <motion.div
                      key={opportunity.id}
                      layout
                      variants={listItemVariants}
                      initial="initial"
                      animate="animate"
                      exit={{ opacity: 0, scale: 0.98, transition: TRANSITION.exit }}
                      transition={{ ...TRANSITION.quick, delay: staggerDelay(i) }}
                    >
                      <OpportunityCard
                        opportunity={opportunity}
                        expanded={expanded === opportunity.id}
                        busy={busy === opportunity.id}
                        onToggle={() =>
                          setExpanded(expanded === opportunity.id ? null : opportunity.id)
                        }
                        onDecide={(status, note) => void decide(opportunity, status, note)}
                        onRun={() => void run(opportunity)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </section>

          {view.dismissed.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-2.5 text-sm font-semibold">
                Not pursuing<span className="ml-1.5 text-faint">{view.dismissed.length}</span>
              </h2>
              <div className="space-y-2">
                {view.dismissed.map((opportunity) => (
                  <DismissedRow
                    key={opportunity.id}
                    opportunity={opportunity}
                    busy={busy === opportunity.id}
                    onRestore={() => void decide(opportunity, 'new', 'Brought back.')}
                  />
                ))}
              </div>
            </section>
          )}

          <DataReviewBlock view={view} />
        </>
      )}
    </ViewScroll>
  );
}

/* ─────────────────────────────── card ─────────────────────────────────── */

function OpportunityCard({
  opportunity,
  expanded,
  busy,
  onToggle,
  onDecide,
  onRun,
}: {
  opportunity: Opportunity;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onDecide: (status: OpportunityStatus, note?: string) => void;
  onRun: () => void;
}): JSX.Element {
  const { impact, confidence, plan } = opportunity;
  const canRun = opportunity.status === 'accepted' || opportunity.status === 'in_progress';

  return (
    <Card variant="hairline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${CONFIDENCE_TONE[confidence.tier] ?? CONFIDENCE_TONE.weak}`}
            >
              <Icon name="lightbulb" size={10} />
              {CONFIDENCE_LABELS[confidence.tier]}
            </span>
            <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-faint">
              {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
            </span>
            {/* Which analysis produced this — a finding should say what kind of thing it is. */}
            <span className="text-[11px] text-faint">
              {OPPORTUNITY_CATEGORY_LABELS[opportunity.category]}
            </span>
          </div>
          <h3 className="mt-1.5 text-base font-semibold">{opportunity.title}</h3>
          <p className="mt-1 max-w-[640px] text-sm leading-relaxed text-muted">
            {opportunity.finding}
          </p>
          <p className="mt-1 max-w-[640px] text-sm leading-relaxed text-muted">{opportunity.why}</p>
        </div>

        {impact && (
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold tabular-nums">
              {money(impact.amount, impact.currency)}
            </div>
            {/*
              Never the word "savings". This figure is spend that already
              happened at a price above your own best — calling it a saving
              would turn a measurement into a promise.
            */}
            <div className="text-[11px] leading-tight text-faint">
              already spent above
              <br />
              your best price
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={expanded ? 'sun' : 'eye'} onClick={onToggle}>
          {expanded ? 'Hide the evidence' : 'Show the evidence'}
        </Button>
        {opportunity.status === 'new' && (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onDecide('accepted', 'Worth pursuing.')}
              loading={busy}
            >
              This is worth pursuing
            </Button>
            <Button size="sm" onClick={() => onDecide('rejected', 'Not pursuing.')} disabled={busy}>
              Not pursuing
            </Button>
          </>
        )}
        {canRun && plan.executable && (
          <Button size="sm" variant="primary" icon="plus" onClick={onRun} loading={busy}>
            {plan.executable.label}
          </Button>
        )}
        {/*
          Without this, `in_progress` is a dead end: NeuroPause did its one
          step and the person has no way to record that they finished theirs.
          Labelled as their attestation, because nothing here can verify that
          the sourcing actually concluded.
        */}
        {opportunity.status === 'in_progress' && (
          <Button
            size="sm"
            icon="check"
            onClick={() => onDecide('completed', 'Marked done — the sourcing is finished.')}
            disabled={busy}
          >
            I have finished this
          </Button>
        )}
        {/*
          The step that files the measurement into the audit trail. Without it
          the whole revision chain is unreachable from the product — every
          transition into `measured` would come from a test. The handler
          refuses if no real measurement exists, so this cannot manufacture
          one; `onRecordRefused` is what tells the user that happened, instead
          of the button appearing to do nothing.
        */}
        {opportunity.status === 'completed' && (
          <Button
            size="sm"
            variant="primary"
            icon="analytics"
            onClick={() => onDecide('measured', 'Measurement recorded.')}
            disabled={busy}
          >
            Record the measurement
          </Button>
        )}
        {opportunity.executionRef && (
          <span className="text-xs text-faint">
            <Icon name="check" size={10} /> {opportunity.executionRef.label} created
          </span>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={TRANSITION.quick}
            className="overflow-hidden"
          >
            <Detail opportunity={opportunity} />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/* ────────────────────────────── detail ────────────────────────────────── */

function Detail({ opportunity }: { opportunity: Opportunity }): JSX.Element {
  const { impact, confidence, plan, ranking } = opportunity;
  return (
    <div className="mt-4 space-y-3 border-t border-[var(--hairline)] pt-4">
      <Block title="What this is based on">
        <ul className="space-y-2">
          {opportunity.evidence.map((item) => (
            <li key={item.label}>
              <div className="text-sm font-medium">{item.label}</div>
              <p className="text-sm leading-relaxed text-muted">{item.detail}</p>
              {item.records.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.records.map((record) => (
                    <span
                      key={record.recordId}
                      className="rounded-md border border-[var(--hairline)] px-1.5 py-0.5 text-[11px] text-faint"
                    >
                      {record.label}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Block>

      {/*
        Deliberately given the same prominence as the evidence. A finding whose
        limits are in small print is a finding that will be over-trusted.
      */}
      <Block title="What NeuroPause cannot establish">
        <ul className="space-y-1.5">
          {opportunity.unknown.map((line) => (
            <li key={line} className="flex gap-2 text-sm leading-relaxed text-muted">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--hairline)]" />
              {line}
            </li>
          ))}
        </ul>
      </Block>

      <Block title={`Why this reads as ${CONFIDENCE_LABELS[confidence.tier].toLowerCase()}`}>
        <p className="mb-2 text-sm leading-relaxed text-muted">{confidence.basis}</p>
        <ul className="space-y-1.5">
          {confidence.checks.map((check) => (
            <li key={check.label} className="flex gap-2 text-sm leading-relaxed">
              <Icon
                name={check.passed ? 'check' : 'close'}
                size={12}
                className={check.passed ? 'mt-1 text-sysgreen' : 'mt-1 text-faint'}
              />
              <span className="text-muted">
                <span className="font-medium text-[var(--text)]">{check.label}.</span>{' '}
                {check.detail}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      {impact && (
        <Block title="How the number was worked out">
          <p className="text-sm leading-relaxed text-muted">{impact.basis}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{impact.caveat}</p>
        </Block>
      )}
      {opportunity.impactUnavailable && (
        <Block title="Why there is no figure">
          <p className="text-sm leading-relaxed text-muted">{opportunity.impactUnavailable}</p>
        </Block>
      )}

      <Block title="What NeuroPause recommends">
        <p className="text-sm leading-relaxed text-muted">{opportunity.recommendation}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{plan.objective}</p>
        <div className="mt-2.5 space-y-2">
          {plan.steps.map((step) => (
            <div key={step.order} className="flex gap-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] text-[11px] tabular-nums text-faint">
                {step.order}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {step.title}
                  <span className="ml-1.5 text-[11px] font-normal text-faint">
                    {step.performedBy === 'neuropause' ? 'NeuroPause does this' : 'you do this'}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Before anything runs">
        <dl className="grid gap-2 sm:grid-cols-2">
          {/* The sentence that refuses to promise an outcome. It belongs on screen. */}
          <Fact label="What to expect" value={plan.expectedEffect} />
          <Fact label="Risk" value={plan.risk} />
          <Fact label="Permission needed" value={plan.requiredPermissions.join(', ')} />
          <Fact
            label="Approval"
            value={
              plan.approvalRequired ??
              'No approval policy governs creating an RFQ today, so none is requested.'
            }
          />
          <Fact label="How it is verified" value={plan.verification} />
        </dl>
      </Block>

      {/*
        The loop's last step, and the only one that can say whether any of this
        mattered. Loaded lazily with the expanded detail, so opening the screen
        does not measure every finding on it.
      */}
      <OutcomeSection
        opportunityId={opportunity.id}
        // Re-measures when the finding beneath it moves — running the plan
        // while this panel is open must not leave it saying "no action has
        // been run".
        revision={`${opportunity.status}|${opportunity.executionRef?.recordId ?? ''}|${opportunity.statusChangedAt ?? ''}`}
      />

      <Block title="Why it is ranked here">
        <p className="text-sm leading-relaxed text-muted">{ranking.basis}</p>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {ranking.factors.map((factor) => (
            <Fact key={factor.label} label={`${factor.label} — ${factor.value}`} value={factor.effect} />
          ))}
        </dl>
      </Block>

      <p className="text-xs text-faint">
        Derived by NeuroPause from {opportunity.sourceRecords.length} purchase orders. Not stated by
        you, not imported, not supplied by any outside service.
        {opportunity.statusChangedAt &&
          ` Last decided ${new Date(opportunity.statusChangedAt).toLocaleString()}${opportunity.statusChangedBy ? ` by ${opportunity.statusChangedBy}` : ''}.`}
        {opportunity.decisionId &&
          ` Decision Record ${opportunity.decisionId} holds the full account of what ran.`}
      </p>
    </div>
  );
}

/* ───────────────────────── empty + review states ──────────────────────── */

function InsufficientState({ view }: { view: OpportunityCenterView }): JSX.Element {
  return (
    <Card variant="hairline">
      <div className="flex items-start gap-2.5">
        <Icon name="info" size={16} className="mt-0.5 shrink-0 text-faint" />
        <div className="min-w-0">
          <p className="text-sm leading-relaxed">{view.insufficient}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            NeuroPause will not invent a finding to fill this space. What it looked at is below, so
            you can see exactly why there is nothing to report rather than wondering whether the
            analysis ran.
          </p>
        </div>
      </div>
    </Card>
  );
}

function DataReviewBlock({ view }: { view: OpportunityCenterView }): JSX.Element {
  const { review } = view;
  return (
    <section className="mb-4">
      <h2 className="mb-2.5 text-sm font-semibold">What was examined</h2>
      <Card variant="hairline">
        {/*
          Three separate counts, because collapsing them misstates the middle
          one: an order outside the window is not an order that "did not carry
          the fields", and saying so sends the reader to fix the wrong thing.
        */}
        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact
            label="Purchase orders read"
            value={`${review.ordersExamined} in total; ${review.ordersInWindow} fall inside the last ${review.windowDays} days.`}
          />
          <Fact
            label="Usable for this comparison"
            value={`${review.ordersUsable} of those were committed orders carrying a product, supplier, quantity, unit cost and currency.`}
          />
          <Fact
            label="Products"
            value={`${plural(review.productsExamined, 'distinct product', 'distinct products')}; ${review.productsCompared} had more than one supplier and could be compared.`}
          />
          <Fact label="Derived" value={`This pass ran at ${new Date(view.derivedAt).toLocaleString()}. Nothing here is cached — Refresh recomputes it from your records.`} />
        </dl>

        {review.truncated && (
          <div className="mt-3">
            <NoticeBlock icon="info">
              This analysis read only the most recently updated purchase orders and there are at
              least that many, so older orders were not included. Narrow the window, or treat this
              as a partial view.
            </NoticeBlock>
          </div>
        )}

        {review.exclusions.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wider text-faint">
              What was set aside, and why
            </div>
            <ul className="mt-1.5 space-y-1">
              {/*
                The unit is shown because the list mixes them: some reasons set
                aside one ORDER, others a whole PRODUCT. "1×" against both is
                unreadable.
              */}
              {review.exclusions.map((exclusion) => (
                <li key={exclusion.reason} className="flex gap-2 text-sm text-muted">
                  <span className="shrink-0 tabular-nums text-faint">
                    {plural(exclusion.count, exclusion.unit, `${exclusion.unit}s`)}
                  </span>
                  {exclusion.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {review.wouldImprove.length > 0 && (
          <div className="mt-3">
            <div className="text-xs uppercase tracking-wider text-faint">
              What would let NeuroPause say more
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {review.wouldImprove.map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-relaxed text-muted">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--hairline)]" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}

function DismissedRow({
  opportunity,
  busy,
  onRestore,
}: {
  opportunity: Opportunity;
  busy: boolean;
  onRestore: () => void;
}): JSX.Element {
  const now = opportunity.impact?.amount ?? null;
  const then = opportunity.impactAtDecision;
  // Reported in BOTH directions. Announcing only growth would be selective
  // reporting in the product's own favour — the one direction that makes the
  // finding look more important than the user judged it.
  const moved = now !== null && then !== null && now !== then;
  return (
    <Card variant="hairline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{opportunity.title}</div>
          <p className="text-xs text-muted">
            {opportunity.statusNote}
            {moved && opportunity.impact && (
              <>
                {' '}
                It was {money(then as number, opportunity.impact.currency)} when you set it aside;
                it is {money(now as number, opportunity.impact.currency)} now.
              </>
            )}
          </p>
        </div>
        <Button size="sm" icon="undo" onClick={onRestore} disabled={busy}>
          Bring it back
        </Button>
      </div>
    </Card>
  );
}

/* ──────────────────────────── primitives ──────────────────────────────── */

function Block({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--hairline)] px-3.5 py-3">
      <div className="mb-1.5 text-xs uppercase tracking-wider text-faint">{title}</div>
      {children}
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
