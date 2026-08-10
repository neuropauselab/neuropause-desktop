/**
 * Identity — the screen where an ambiguous match becomes a decision.
 *
 * WHY THIS SCREEN EXISTS
 *
 * Program 9's connector bridge could tell that an incoming row *probably*
 * matched an existing record, and had nowhere to say so. It counted the row as
 * `ambiguous` in a sync summary and dropped it. The effect on a real desk: the
 * customer never appeared, a number in a finished summary was the only trace,
 * and no human was ever asked the one question that would have resolved it.
 *
 * So this is not a dashboard. Each card is a question with three answers, and
 * the answers are deliberately asymmetric:
 *
 *   · Yes, this is the same — link, and fill only the fields that are empty.
 *   · Create a new record  — none of these. Make one from the provider's data.
 *   · Not a match          — none of these, and do not create. Stays unlinked.
 *
 * The side-by-side is the whole design. Before confirming, the person sees every
 * field that would change with the existing value beside the incoming one — so
 * confirming is never a leap of faith, and the fact that an existing value is
 * KEPT rather than overwritten is stated on the row it applies to instead of
 * being a promise in a doc comment.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExternalIdentity, IdentityMatch, IdentityState, ServiceIdentity } from '@neuropause/shared';
import { IDENTITY_STATE_LABEL } from '@neuropause/shared';
import { cn } from '@renderer/lib/cn';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Button } from '@renderer/components/ui/Button';
import { Icon } from '@renderer/components/ui/Icon';
import { Loading } from '@renderer/components/ui/Loading';
import { friendlyError } from './dataCommandCenterModel';
import { DataTable, ErrorBlock, NoticeBlock, Section, StatusPill, Td, Th, type Tone } from './primitives';

const log = createLogger('identity-panel');

type Busy = { matchId: string; decision: string } | null;

const STATE_TONE: Record<IdentityState, Tone> = {
  known: 'good',
  probable: 'neutral',
  ambiguous: 'warn',
  unknown: 'neutral',
  revoked: 'bad',
};

/** Evidence kinds are machine words. This is how they read to a person. */
function evidenceLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

/**
 * One pending question.
 *
 * One card per provider object, not one row per candidate: the person is
 * answering "which of these is it?", and splitting that across rows would let
 * them confirm two contradictory answers for the same object.
 */
function MatchCard({
  match,
  busy,
  onDecide,
}: {
  match: IdentityMatch;
  busy: Busy;
  onDecide: (matchId: string, decision: 'confirm' | 'create_new' | 'reject', subjectId?: string) => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<string | null>(match.candidates[0]?.subject.id ?? null);
  const candidate = match.candidates.find((c) => c.subject.id === chosen) ?? match.candidates[0] ?? null;
  const working = busy?.matchId === match.id;

  return (
    <div className="rounded-xl border border-[var(--hairline)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{match.incomingLabel}</span>
            <StatusPill tone={match.state === 'unknown' ? 'neutral' : 'warn'}>
              {IDENTITY_STATE_LABEL[match.state]}
            </StatusPill>
          </div>
          <p className="mt-1 text-xs text-faint">
            From {match.provider} · {match.providerEntityType} · would be written to {match.destinationLabel}
          </p>
        </div>
        {match.seenCount > 1 && (
          <span className="text-xs text-faint">
            Raised {match.seenCount} times — last {new Date(match.lastSeenAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* The engine's own words, verbatim. Never a paraphrase — the person is
          being asked to overrule it, so they need to read what it actually said. */}
      <p className="mt-3 rounded-lg [background:var(--fill-1)] px-3 py-2 text-xs text-muted">{match.reason}</p>

      {match.candidates.length === 0 ? (
        <div className="mt-3">
          <NoticeBlock icon="info">
            Nothing in NeuroPause looks like this. Creating a new record is the only answer that adds it — &ldquo;not a
            match&rdquo; leaves the provider&rsquo;s row where it is.
          </NoticeBlock>
        </div>
      ) : (
        <>
          {match.candidates.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Candidate records">
              {match.candidates.map((c) => (
                <button
                  key={c.subject.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen === c.subject.id}
                  onClick={() => setChosen(c.subject.id)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-sm',
                    chosen === c.subject.id
                      ? 'border-accent/40 bg-accent/12 text-accent'
                      : 'border-[var(--hairline)] text-muted',
                  )}
                >
                  {c.subject.label}
                  <span className="ml-2 text-xs opacity-70">{Math.round(c.confidence * 100)}%</span>
                </button>
              ))}
            </div>
          )}

          {candidate && (
            <div className="mt-3">
              <p className="font-medium">Why {candidate.subject.label} is offered</p>
              <ul className="mt-1 space-y-1 text-sm text-muted">
                {candidate.evidence.map((e, i) => (
                  <li key={`${e.kind}-${i}`} className="flex gap-2">
                    <Icon name="info" size={12} className="mt-1 shrink-0 opacity-60" />
                    <span>
                      <span className="text-ink">{evidenceLabel(e.kind)}</span> on{' '}
                      <span className="font-mono text-xs">{e.field}</span> — {e.detail}
                    </span>
                  </li>
                ))}
              </ul>

              {/* What confirming would actually change. The empty case matters as
                  much as the populated one: "nothing would change" is a real
                  answer and is stated rather than rendered as a blank table. */}
              <p className="mt-3 font-medium">What confirming would change</p>
              {candidate.differs.length === 0 ? (
                <p className="mt-1 text-sm text-muted">
                  Nothing. Every incoming value already matches what is on the record.
                </p>
              ) : (
                <div className="mt-2">
                  <DataTable
                    head={
                      <>
                        <Th>Field</Th>
                        <Th>On the record now</Th>
                        <Th>Coming from {match.provider}</Th>
                        <Th>Result</Th>
                      </>
                    }
                  >
                    {candidate.differs.map((d) => {
                      const willFill = d.existing.trim() === '';
                      return (
                        <tr key={d.field}>
                          <Td>{d.label}</Td>
                          <Td className="text-muted">
                            {d.existing.trim() === '' ? <span className="text-faint">empty</span> : d.existing}
                          </Td>
                          <Td className="text-muted">
                            {d.incoming.trim() === '' ? <span className="text-faint">empty</span> : d.incoming}
                          </Td>
                          <Td>
                            {willFill ? (
                              <StatusPill tone="good">Will be filled in</StatusPill>
                            ) : (
                              <StatusPill tone="neutral">Kept as it is</StatusPill>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </DataTable>
                </div>
              )}
              {candidate.differs.some((d) => d.existing.trim() !== '') && (
                <p className="mt-2 text-xs text-faint">
                  Confirming never overwrites a value that is already there. Fields that already have a value stay
                  exactly as they are, even where the provider disagrees.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {match.candidates.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            disabled={working || chosen === null}
            onClick={() => chosen !== null && onDecide(match.id, 'confirm', chosen)}
          >
            {busy?.matchId === match.id && busy.decision === 'confirm' ? 'Linking…' : 'Yes, this is the same'}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={working} onClick={() => onDecide(match.id, 'create_new')}>
          {busy?.matchId === match.id && busy.decision === 'create_new' ? 'Creating…' : 'Create a new record'}
        </Button>
        <Button variant="ghost" size="sm" disabled={working} onClick={() => onDecide(match.id, 'reject')}>
          {busy?.matchId === match.id && busy.decision === 'reject' ? 'Saving…' : 'Not a match'}
        </Button>
      </div>
    </div>
  );
}

export function IdentityPanel(): JSX.Element {
  const [queue, setQueue] = useState<IdentityMatch[] | null>(null);
  const [links, setLinks] = useState<ExternalIdentity[]>([]);
  const [services, setServices] = useState<ServiceIdentity[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ title: string; detail: string; canRetry: boolean } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [q, l, s] = await Promise.all([
        ipc.data.identity.queue(200),
        ipc.data.identity.list({ limit: 200 }),
        // A refusal here must not take the questions down with it: the list is
        // secondary to the decisions this screen exists for.
        ipc.data.identity.services().catch(() => [] as ServiceIdentity[]),
      ]);
      setQueue(q);
      setLinks(l);
      setServices(s);
    } catch (err) {
      log.warn('Could not load identity state', {
        message: err instanceof Error ? err.message : String(err),
      });
      setError(friendlyError(err));
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    (matchId: string, decision: 'confirm' | 'create_new' | 'reject', subjectId?: string): void => {
      setBusy({ matchId, decision });
      setNote(null);
      void ipc.data.identity
        .confirm(matchId, decision, subjectId)
        .then((res) => {
          // The main process's own sentence, not a generic success toast. It is
          // the only thing that knows what actually happened.
          setNote(res.message);
          return load();
        })
        .catch((err: unknown) => {
          log.warn('Identity decision failed', {
            decision,
            message: err instanceof Error ? err.message : String(err),
          });
          setError(friendlyError(err));
        })
        .finally(() => setBusy(null));
    },
    [load],
  );

  const unlink = useCallback(
    (identityId: string): void => {
      void ipc.data.identity
        .unlink(identityId)
        .then((res) => {
          setNote(res.message);
          return load();
        })
        .catch((err: unknown) => setError(friendlyError(err)));
    },
    [load],
  );

  const setServiceStatus = useCallback(
    (service: ServiceIdentity): void => {
      void ipc.data.identity
        .setServiceStatus(service.id, service.status === 'active' ? 'disabled' : 'active')
        .then(() => load())
        .catch((err: unknown) => setError(friendlyError(err)));
    },
    [load],
  );

  const pending = useMemo(() => queue ?? [], [queue]);

  if (queue === null) return <Loading kind="panel" cards={3} />;

  return (
    <div>
      {error && (
        <div className="mb-5">
          <ErrorBlock title={error.title} detail={error.detail} onRetry={error.canRetry ? () => void load() : undefined} />
        </div>
      )}
      {note && (
        <div className="mb-5">
          <NoticeBlock icon="check">{note}</NoticeBlock>
        </div>
      )}

      <Section
        title={pending.length > 0 ? `Needs a decision · ${pending.length}` : 'Needs a decision'}
        subtitle="Rows a connector could not identify on its own. Nothing is written until you answer — and until you do, the row has not arrived."
        icon="user"
      >
        {pending.length === 0 ? (
          <NoticeBlock icon="check">
            No open questions. When a sync finds a row it cannot identify with confidence it appears here, rather than
            being counted in a summary and discarded.
          </NoticeBlock>
        ) : (
          <div className="space-y-4">
            {pending.map((m) => (
              <MatchCard key={m.id} match={m} busy={busy} onDecide={decide} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Linked identities"
        subtitle="What a provider's object is, in NeuroPause terms — with the evidence the link rests on."
        icon="eye"
      >
        {links.length === 0 ? (
          <NoticeBlock icon="info">Nothing linked yet.</NoticeBlock>
        ) : (
          <DataTable
            head={
              <>
                <Th>From</Th>
                <Th>Is</Th>
                <Th>State</Th>
                <Th>On what evidence</Th>
                <Th>Confirmed by</Th>
                <Th />
              </>
            }
          >
            {links.map((identity) => (
              <tr key={identity.id}>
                <Td>
                  <span className="text-ink">{identity.displayName}</span>
                  <span className="ml-2 text-xs text-faint">
                    {identity.provider} · {identity.providerEntityType}
                  </span>
                </Td>
                <Td className="text-muted">{identity.subject?.label ?? '—'}</Td>
                <Td>
                  <StatusPill tone={STATE_TONE[identity.state]}>{IDENTITY_STATE_LABEL[identity.state]}</StatusPill>
                </Td>
                <Td className="text-muted">
                  {identity.evidence.length === 0 ? '—' : identity.evidence.map((e) => evidenceLabel(e.kind)).join(', ')}
                </Td>
                <Td className="text-muted">
                  {identity.confirmedBy ?? <span className="text-faint">not by a person</span>}
                </Td>
                <Td>
                  {identity.subject !== null && (
                    <Button variant="ghost" size="sm" onClick={() => unlink(identity.id)}>
                      Unlink
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>

      {services.length > 0 && (
        <Section
          title="Background services"
          subtitle="Work that runs with nobody present. Each holds only the permissions listed here — never an administrator's."
          icon="shield"
        >
          <DataTable
            head={
              <>
                <Th>Service</Th>
                <Th>May do</Th>
                <Th>Last acted</Th>
                <Th>State</Th>
                <Th />
              </>
            }
          >
            {services.map((service) => (
              <tr key={service.id}>
                <Td>
                  <span className="text-ink">{service.purpose}</span>
                  <span className="ml-2 font-mono text-xs text-faint">{service.id}</span>
                </Td>
                <Td className="text-muted">{service.permissions.join(', ') || 'nothing'}</Td>
                <Td className="text-muted">
                  {service.lastAction === null ? (
                    <span className="text-faint">never</span>
                  ) : (
                    <>
                      {service.lastUsedAt !== null && new Date(service.lastUsedAt).toLocaleString()}
                      <span className="block text-xs text-faint">{service.lastAction}</span>
                    </>
                  )}
                </Td>
                <Td>
                  <StatusPill tone={service.status === 'active' ? 'good' : 'neutral'}>
                    {service.status === 'active' ? 'Running' : 'Stopped'}
                  </StatusPill>
                </Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => setServiceStatus(service)}>
                    {service.status === 'active' ? 'Stop' : 'Start'}
                  </Button>
                </Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
