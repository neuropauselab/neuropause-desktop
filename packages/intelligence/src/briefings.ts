/**
 * Module 6 — Executive Briefing Engine. ONE engine, thirteen templates (morning …
 * compliance). Each briefing assembles deterministic sections from real graph/timeline/
 * reasoning data, then produces a governed, evidence-grounded summary through the
 * AnswerEngine. Templates with no live data source (e.g. sales/finance) say so plainly.
 */
import { type Clock } from '@neuropause/cloud-core';
import type { AiAnswer, EvidenceRef } from './types';
import type { KnowledgeGraph } from './graph';
import type { EnterpriseTimeline } from './timeline';
import type { ReasoningEngine } from './reasoning';
import type { IntelligenceServices } from './intelligence';
import type { AnswerEngine } from './engine';
import { BRIEFING_TYPES, type BriefingType } from './constants';

export interface BriefingSection {
  title: string;
  body: string;
  evidence: EvidenceRef[];
}

export interface Briefing {
  type: BriefingType;
  tenantId: string;
  generatedAt: number;
  sections: BriefingSection[];
  summary: AiAnswer;
}

export interface BriefingDeps {
  graph: KnowledgeGraph;
  timeline: EnterpriseTimeline;
  reasoning: ReasoningEngine;
  intelligence: IntelligenceServices;
  answerEngine: AnswerEngine;
  clock: Clock;
}

export class BriefingEngine {
  constructor(private readonly deps: BriefingDeps) {}

  types(): BriefingType[] {
    return [...BRIEFING_TYPES];
  }

  private sections(type: BriefingType, tenantId: string): BriefingSection[] {
    const recent = this.deps.timeline.unified(tenantId).slice(-8);
    const risks = this.deps.intelligence.risk(tenantId);
    const objectives = this.deps.graph.list(tenantId, 'objective');
    const avg = objectives.length ? Math.round(objectives.reduce((a, o) => a + Number(o.metadata.progress ?? 0), 0) / objectives.length) : 0;

    const sections: BriefingSection[] = [
      { title: 'Highlights', body: recent.length ? recent.map((e) => e.type).join(', ') : 'No recent activity.', evidence: recent.map((e) => ({ kind: 'timeline', id: e.entityId, source: e.source, detail: e.type, at: e.at })) },
      { title: 'Risks', body: risks.findings.length ? risks.findings.map((f) => f.label).join('; ') : 'No risks detected.', evidence: risks.findings.flatMap((f) => f.evidence) },
      { title: 'OKR progress', body: objectives.length ? `${objectives.length} objectives, ${avg}% average progress.` : 'No objectives recorded.', evidence: objectives.flatMap((o) => o.evidence) },
    ];

    if (type === 'incident') {
      const anomalies = this.deps.intelligence.anomaly(tenantId);
      sections.push({ title: 'Incidents / anomalies', body: anomalies.findings.length ? anomalies.findings.map((f) => f.label).join('; ') : 'No anomalies.', evidence: anomalies.findings.flatMap((f) => f.evidence) });
    } else if (type === 'engineering') {
      const eng = this.deps.timeline.unified(tenantId, { track: 'engineering' });
      sections.push({ title: 'Engineering activity', body: `${eng.length} engineering events.`, evidence: eng.slice(-5).map((e) => ({ kind: 'timeline', id: e.entityId, source: e.source, detail: e.type, at: e.at })) });
    } else if (type === 'compliance') {
      const controls = this.deps.graph.list(tenantId, 'compliance_control');
      sections.push({ title: 'Compliance controls', body: controls.length ? `${controls.length} controls tracked.` : 'No compliance controls connected in this environment (infra-pending).', evidence: controls.flatMap((c) => c.evidence) });
    } else if (type === 'sales' || type === 'finance') {
      sections.push({ title: 'Note', body: `No live ${type} connector data in this environment — this section is infra-pending, not fabricated.`, evidence: [] });
    }
    return sections;
  }

  async generate(type: BriefingType, tenantId: string, actor: string): Promise<Briefing> {
    const sections = this.sections(type, tenantId);
    const evidence = sections.flatMap((s) => s.evidence);
    const summary = await this.deps.answerEngine.answer({
      tenantId,
      actor,
      kind: `briefing.${type}`,
      question: `Produce the ${type} briefing from the evidence.`,
      evidence,
    });
    return { type, tenantId, generatedAt: this.deps.clock.now(), sections, summary };
  }
}
