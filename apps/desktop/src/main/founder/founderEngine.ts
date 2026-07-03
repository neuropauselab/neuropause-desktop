/**
 * The Founder AI engine. Rule-based intent routing over connected data — no
 * language model. Each intent computes facts (read from data, with evidence) and
 * suggestions (derived recommendations), kept strictly separate. Pure: data and
 * a graph-neighbor lookup are injected, so it unit-tests from synthetic input.
 */
import type {
  EnterpriseTimelineEntry,
  FounderAnswer,
  FounderFact,
  FounderIntent,
  FounderReference,
  FounderSuggestion,
  UnifiedEntity,
} from '@neuropause/shared';
import { classifyStatus, daysBetween, eventTime, isOpenTask } from '../intelligence/classify';
import { generateRecommendations } from '../recommendations/recommendationEngine';

export interface FounderNeighbor {
  id: string;
  type: string;
  label: string;
  rel: string;
  direction: 'out' | 'in';
}

export interface FounderInput {
  entities: UnifiedEntity[];
  events: EnterpriseTimelineEntry[];
  now: string;
  /** Optional graph lookup (resolves a node id to its neighbors). */
  neighbors?: (nodeId: string) => FounderNeighbor[];
}

function classifyIntent(text: string): FounderIntent {
  const t = text.toLowerCase();
  if (/\b(block|blocked|stall|stalled|stuck|at risk|at-risk|behind|attention)\b/.test(t)) return 'blocked';
  if (/\b(how many|number of|count of|how much)\b/.test(t)) return 'count';
  if (/\bwho\b/.test(t)) return 'who';
  if (/\b(what happened|what did|activity|recently|this week|today|yesterday|last week)\b/.test(t)) return 'activity';
  if (/\b(status|how is|how's|hows|progress|going|update on|state of)\b/.test(t)) return 'status';
  if (/\b(find|show me|where is|locate|look for|search)\b/.test(t)) return 'find';
  return 'overview';
}

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3);
}

/** Resolve the entity the question is about by title/word overlap. */
function resolveSubject(text: string, entities: UnifiedEntity[]): UnifiedEntity | null {
  const q = new Set(tokens(text));
  let best: UnifiedEntity | null = null;
  let bestScore = 0;
  for (const e of entities) {
    const et = tokens(e.title);
    if (et.length === 0) continue;
    let overlap = 0;
    for (const w of et) if (q.has(w)) overlap++;
    const score = overlap / et.length;
    if (overlap > 0 && score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function ref(e: UnifiedEntity): FounderReference {
  return { id: e.id, kind: e.kind, title: e.title, connectorId: e.connectorId, at: eventTime(e) };
}

function ev(e: UnifiedEntity) {
  return { kind: e.kind, id: e.id };
}

function lastActivityMap(events: EnterpriseTimelineEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const event of events) {
    for (const r of event.entityRefs) {
      const prev = m.get(r);
      if (!prev || event.at > prev) m.set(r, event.at);
    }
  }
  return m;
}

function countKind(text: string): { kind: string; label: string; match: (e: UnifiedEntity) => boolean } {
  const t = text.toLowerCase();
  if (/\bopen task|todo|to-do\b/.test(t)) return { kind: 'task', label: 'open tasks', match: isOpenTask };
  if (/\btask\b/.test(t)) return { kind: 'task', label: 'tasks', match: (e) => e.kind === 'task' };
  if (/\bdocument|doc\b/.test(t)) return { kind: 'document', label: 'documents', match: (e) => e.kind === 'document' };
  if (/\bmeeting|event\b/.test(t)) return { kind: 'meeting', label: 'meetings', match: (e) => e.kind === 'calendar_event' || e.kind === 'event' };
  if (/\bproject\b/.test(t)) return { kind: 'project', label: 'projects', match: (e) => e.kind === 'project' };
  if (/\bmessage\b/.test(t)) return { kind: 'message', label: 'messages', match: (e) => e.kind === 'message' };
  if (/\bconversation|channel\b/.test(t)) return { kind: 'conversation', label: 'conversations', match: (e) => e.kind === 'conversation' };
  return { kind: 'entity', label: 'records', match: () => true };
}

function deriveSuggestions(input: FounderInput, refs?: Set<string>): FounderSuggestion[] {
  const recs = generateRecommendations(
    { entities: input.entities, events: input.events, now: input.now },
    { limit: 5 },
  );
  const filtered = refs ? recs.filter((r) => r.entityRefs.some((x) => refs.has(x))) : recs;
  return filtered.slice(0, 5).map((r) => ({ text: `${r.title} — ${r.rationale}`, evidence: r.evidence }));
}

export function answerFounderQuestion(text: string, input: FounderInput): FounderAnswer {
  const intent = classifyIntent(text);
  const grounded = input.entities.length > 0 || input.events.length > 0;
  const facts: FounderFact[] = [];
  const suggestions: FounderSuggestion[] = [];
  const references: FounderReference[] = [];

  if (!grounded) {
    return {
      question: text,
      intent,
      summary: 'No connected data yet — connect an account and Founder AI can answer from your real work.',
      facts: [],
      suggestions: [],
      references: [],
      evidenceCount: 0,
      grounded: false,
    };
  }

  const pushFact = (t: string, evidence: { kind: string; id: string }[]): void => {
    facts.push({ text: t, evidence });
  };

  if (intent === 'count') {
    const spec = countKind(text);
    const matched = input.entities.filter(spec.match);
    pushFact(
      `${matched.length} ${spec.label} found across connected systems.`,
      matched.slice(0, 10).map(ev),
    );
    references.push(...matched.slice(0, 8).map(ref));
  } else if (intent === 'status') {
    const subject = resolveSubject(text, input.entities);
    if (!subject) {
      pushFact('No matching project or item was found for that question.', []);
    } else {
      references.push(ref(subject));
      const children = input.entities.filter((e) => e.containerId === subject.id);
      const openChildren = children.filter(isOpenTask);
      const last = lastActivityMap(input.events).get(subject.id);
      pushFact(
        `${subject.title} — status "${subject.status ?? 'unknown'}" (${classifyStatus(subject.status)}).`,
        [ev(subject)],
      );
      if (children.length > 0) {
        pushFact(
          `${openChildren.length} open of ${children.length} linked task(s).`,
          children.slice(0, 8).map(ev),
        );
        references.push(...openChildren.slice(0, 6).map(ref));
      }
      if (last) pushFact(`Last recorded activity ${Math.floor(daysBetween(last, input.now))} day(s) ago.`, []);
      suggestions.push(...deriveSuggestions(input, new Set([subject.id, ...children.map((c) => c.id)])));
    }
  } else if (intent === 'blocked') {
    const recs = generateRecommendations(
      { entities: input.entities, events: input.events, now: input.now },
      { kinds: ['blocked_project', 'stale_task'], limit: 10 },
    );
    if (recs.length === 0) {
      pushFact('Nothing appears blocked or stalled in the connected data.', []);
    } else {
      for (const r of recs) {
        pushFact(r.rationale, r.evidence); // the observation is the fact
        suggestions.push({ text: r.title, evidence: r.evidence }); // the action is the suggestion
      }
    }
  } else if (intent === 'activity') {
    const subject = resolveSubject(text, input.entities);
    const scoped = subject
      ? input.events.filter((e) => e.entityRefs.includes(subject.id) || e.resourceId === subject.id)
      : input.events.slice(0, 50);
    if (subject) references.push(ref(subject));
    const byCat = new Map<string, string[]>();
    for (const e of scoped) {
      const arr = byCat.get(e.category) ?? [];
      if (arr.length < 5) arr.push(e.id);
      byCat.set(e.category, arr);
    }
    pushFact(
      subject
        ? `${scoped.length} recorded event(s) involving ${subject.title}.`
        : `${scoped.length} recent recorded event(s).`,
      scoped.slice(0, 10).map((e) => ({ kind: 'event', id: e.id })),
    );
    for (const [cat, ids] of byCat) pushFact(`${ids.length}+ ${cat} event(s).`, ids.map((id) => ({ kind: 'event', id })));
  } else if (intent === 'find') {
    const q = new Set(tokens(text));
    const matched = input.entities
      .map((e) => ({ e, score: tokens(e.title).filter((w) => q.has(w)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.e);
    pushFact(`Found ${matched.length} item(s) matching the query.`, matched.map(ev));
    references.push(...matched.map(ref));
  } else if (intent === 'who') {
    const subject = resolveSubject(text, input.entities);
    if (!subject) {
      pushFact('No matching subject was found to trace people for.', []);
    } else {
      references.push(ref(subject));
      const people = input.neighbors
        ? input.neighbors(subject.id).filter((n) => n.type === 'person')
        : [];
      if (people.length === 0) {
        pushFact(`No people are linked to ${subject.title} in the knowledge graph yet.`, [ev(subject)]);
      } else {
        pushFact(
          `${people.length} person(s) linked to ${subject.title}: ${people.map((p) => p.label).join(', ')}.`,
          [ev(subject), ...people.map((p) => ({ kind: 'person', id: p.id }))],
        );
      }
    }
  } else {
    // overview
    const projects = input.entities.filter((e) => e.kind === 'project');
    const openTasks = input.entities.filter(isOpenTask);
    const docs = input.entities.filter((e) => e.kind === 'document');
    const meetings = input.entities.filter((e) => e.kind === 'calendar_event' || e.kind === 'event');
    pushFact(
      `${projects.length} project(s), ${openTasks.length} open task(s), ${docs.length} document(s), ${meetings.length} meeting(s) across connected systems.`,
      [...projects.slice(0, 4), ...openTasks.slice(0, 4)].map(ev),
    );
    if (input.events.length > 0) {
      pushFact(`${input.events.length} recorded timeline event(s).`, input.events.slice(0, 5).map((e) => ({ kind: 'event', id: e.id })));
    }
    references.push(
      ...[...input.entities]
        .sort((a, b) => eventTime(b).localeCompare(eventTime(a)))
        .slice(0, 8)
        .map(ref),
    );
    suggestions.push(...deriveSuggestions(input));
  }

  const evidenceCount =
    facts.reduce((n, f) => n + f.evidence.length, 0) +
    suggestions.reduce((n, s) => n + s.evidence.length, 0);

  const summary =
    facts.length > 0
      ? facts[0]!.text + (suggestions.length > 0 ? ` ${suggestions.length} suggestion(s) follow.` : '')
      : 'No matching information was found in the connected data.';

  return { question: text, intent, summary, facts, suggestions, references, evidenceCount, grounded: true };
}
