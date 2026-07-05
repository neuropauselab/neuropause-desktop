import { describe, expect, it } from 'vitest';
import type { ExecutiveCenterSnapshot, IntelligenceItem } from '@neuropause/shared';
import { classifyVoiceIntent } from './voiceIntent';
import { composeVoiceResponse } from './voiceComposer';

describe('classifyVoiceIntent', () => {
  it('recognizes the bare wake phrase as a greeting', () => {
    expect(classifyVoiceIntent('Hello NeuroPause').intent).toBe('greeting');
    expect(classifyVoiceIntent('Hey NeuroPause!').intent).toBe('greeting');
  });

  it('strips the wake phrase and classifies the tail', () => {
    expect(classifyVoiceIntent('Hello NeuroPause, how is engineering?').intent).toBe(
      'engineering-health',
    );
  });

  it('routes engineering and organization health questions', () => {
    expect(classifyVoiceIntent('how is engineering doing').intent).toBe('engineering-health');
    expect(classifyVoiceIntent('how is the organization').intent).toBe('org-health');
    expect(classifyVoiceIntent('how is the company doing').intent).toBe('org-health');
  });

  it('routes risks, connectors, license, brief, recommendations, summarize', () => {
    expect(classifyVoiceIntent('any critical risks?').intent).toBe('critical-risks');
    expect(classifyVoiceIntent('are there connector issues').intent).toBe('connector-status');
    expect(classifyVoiceIntent("how's our license").intent).toBe('license-status');
    expect(classifyVoiceIntent("what's my brief").intent).toBe('mission-brief');
    expect(classifyVoiceIntent('what do you recommend').intent).toBe('founder-recommendations');
    expect(classifyVoiceIntent('summarize everything').intent).toBe('summarize');
  });

  it('routes fix-first / priority / biggest-risk questions (V3.2)', () => {
    expect(classifyVoiceIntent('what should I fix first').intent).toBe('fix-first');
    expect(classifyVoiceIntent('highest priority issue').intent).toBe('fix-first');
    expect(classifyVoiceIntent("what's the biggest risk").intent).toBe('fix-first');
    expect(classifyVoiceIntent('what is the most urgent').intent).toBe('fix-first');
  });

  it('routes decision questions (V3.3)', () => {
    expect(classifyVoiceIntent('what decisions are pending').intent).toBe('decisions-pending');
    expect(classifyVoiceIntent('what did we decide this week').intent).toBe('decisions-recent');
    expect(classifyVoiceIntent('complete decision').intent).toBe('decisions-complete');
  });

  it('resolves open-module targets', () => {
    const r = classifyVoiceIntent('open Founder AI');
    expect(r.intent).toBe('open-module');
    expect(r.target).toBe('ai-workforce/founder');
    expect(classifyVoiceIntent('show me the organization').target).toBe('enterprise/organization');
  });

  it('resolves action targets and marks them', () => {
    const r = classifyVoiceIntent('create a task for tomorrow');
    expect(r.intent).toBe('action');
    expect(r.target).toBe('create-task');
    expect(classifyVoiceIntent('notify the team').target).toBe('notify-team');
  });

  it('falls back to unknown for unmatched requests', () => {
    const r = classifyVoiceIntent('what is the weather in Paris');
    expect(r.intent).toBe('unknown');
    expect(r.confidence).toBeLessThan(0.5);
  });
});

// ── Composer ──────────────────────────────────────────────────────────────────

function item(
  id: string,
  title: string,
  priority: IntelligenceItem['priority'] = 'high',
): IntelligenceItem {
  return { id, title, body: 'b', priority, producedAt: new Date().toISOString() };
}

function snapshot(over: Partial<ExecutiveCenterSnapshot> = {}): ExecutiveCenterSnapshot {
  const base: ExecutiveCenterSnapshot = {
    generatedAt: new Date().toISOString(),
    kpis: [
      {
        key: 'connector-health',
        label: 'Connector Health',
        value: 100,
        display: '3/3 healthy',
        band: 'healthy',
        deepLink: 'connectors',
      },
      {
        key: 'license-status',
        label: 'License',
        value: 100,
        display: '200d left',
        band: 'healthy',
        deepLink: 'settings/billing',
      },
    ],
    orgHealth: {
      activity: 90,
      adoption: 85,
      engineering: 94,
      reliability: 90,
      aiUsage: 80,
      connectorHealth: 100,
      licenseHealth: 100,
      security: 90,
      operational: 90,
      overall: 91,
    },
    criticalAlerts: {
      key: 'critical-alerts',
      title: 'Critical Alerts',
      items: [],
      deepLink: 'notifications',
    },
    founderRecommendations: {
      key: 'founder-recommendations',
      title: 'Founder Recommendations',
      items: [],
      deepLink: 'ai-workforce/founder',
    },
    organizationHealth: {
      key: 'organization-health',
      title: 'Organization Health',
      items: [],
      deepLink: 'enterprise/organization',
    },
    engineeringHealth: {
      key: 'engineering-health',
      title: 'Engineering Health',
      items: [],
      deepLink: 'ai-workforce/engineering',
    },
    upcomingPriorities: {
      key: 'upcoming-priorities',
      title: 'Upcoming Priorities',
      items: [],
      deepLink: 'enterprise/briefings',
    },
    attentionCounts: { critical: 0, high: 0, normal: 0 },
  };
  return { ...base, ...over };
}

describe('composeVoiceResponse', () => {
  it('greets with the name and a steady tail when nothing critical', () => {
    const r = composeVoiceResponse(
      { intent: 'greeting', confidence: 0.9, transcript: 'Hello NeuroPause' },
      snapshot(),
      { displayName: 'Dishant', timeOfDay: 'morning' },
    );
    expect(r.speech).toContain('Good morning, Dishant.');
    expect(r.speech).toContain('steady');
  });

  it('greeting surfaces critical count when present', () => {
    const r = composeVoiceResponse(
      { intent: 'greeting', confidence: 0.9, transcript: 'hi' },
      snapshot({ attentionCounts: { critical: 2, high: 1, normal: 0 } }),
      { displayName: 'Dishant' },
    );
    expect(r.speech).toContain('2 critical');
  });

  it('reports engineering health from the snapshot (real evidence)', () => {
    const r = composeVoiceResponse(
      { intent: 'engineering-health', confidence: 0.9, transcript: 'how is engineering' },
      snapshot(),
    );
    expect(r.speech).toBe('Engineering health is 94 out of 100 — healthy.');
    expect(r.deepLink).toBe('ai-workforce/engineering');
  });

  it('reports organization health', () => {
    const r = composeVoiceResponse(
      { intent: 'org-health', confidence: 0.9, transcript: 'how is the org' },
      snapshot(),
    );
    expect(r.speech).toContain('91 out of 100');
  });

  it('says no critical risks when there are none, and names the top one when present', () => {
    const none = composeVoiceResponse(
      { intent: 'critical-risks', confidence: 0.9, transcript: 'any risks' },
      snapshot(),
    );
    expect(none.speech).toBe('No critical risks right now.');

    const some = composeVoiceResponse(
      { intent: 'critical-risks', confidence: 0.9, transcript: 'any risks' },
      snapshot({
        attentionCounts: { critical: 1, high: 0, normal: 0 },
        criticalAlerts: {
          key: 'critical-alerts',
          title: 'Critical Alerts',
          items: [item('x', 'License expires in 3 days', 'critical')],
          deepLink: 'notifications',
        },
      }),
    );
    expect(some.speech).toContain('1 critical risk');
    expect(some.speech).toContain('License expires in 3 days');
  });

  it('summarize gives a real multi-metric overview', () => {
    const r = composeVoiceResponse(
      { intent: 'summarize', confidence: 0.9, transcript: 'summarize' },
      snapshot({ attentionCounts: { critical: 1, high: 2, normal: 0 } }),
    );
    expect(r.speech).toContain('Organization health 91');
    expect(r.speech).toContain('engineering 94');
    expect(r.speech).toContain('1 critical and 2 high');
  });

  it('actions require approval and carry the action id', () => {
    const r = composeVoiceResponse(
      { intent: 'action', confidence: 0.9, target: 'create-task', transcript: 'create a task' },
      snapshot(),
    );
    expect(r.requiresApproval).toBe(true);
    expect(r.actionId).toBe('create-task');
    expect(r.speech).toContain('approval');
  });

  it('open-module carries the deep-link', () => {
    const r = composeVoiceResponse(
      {
        intent: 'open-module',
        confidence: 0.9,
        target: 'ai-workforce/founder',
        transcript: 'open founder',
      },
      snapshot(),
    );
    expect(r.deepLink).toBe('ai-workforce/founder');
  });

  it('unknown uses the Founder AI fallback phrase when provided', () => {
    const r = composeVoiceResponse(
      { intent: 'unknown', confidence: 0.3, transcript: 'tell me a joke' },
      snapshot(),
      {},
      'Based on your data, revenue is trending up.',
    );
    expect(r.speech).toBe('Based on your data, revenue is trending up.');
  });

  it('degrades honestly when there is no snapshot', () => {
    const r = composeVoiceResponse(
      { intent: 'org-health', confidence: 0.9, transcript: 'how is the org' },
      null,
    );
    expect(r.speech).toContain("don't have live intelligence");
  });
});
