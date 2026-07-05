/**
 * Voice intent classifier (V2.6).
 *
 * Pure function: a recognized transcript → a VoiceIntent that maps to an EXISTING
 * system. This is deterministic keyword/pattern matching (fast, offline, no model)
 * — the free-form fallback ('unknown') is handled downstream by the existing
 * Founder AI classifier, so we never build a second NLU here.
 */
import type { VoiceIntent, VoiceIntentResult } from '@neuropause/shared';

const WAKE = /\b(hello|hi|hey)\s+neuropause\b/i;

/** Ordered rules; first match wins. Each maps to an existing intelligence system. */
const RULES: Array<{
  intent: VoiceIntent;
  test: RegExp;
  target?: (t: string) => string | undefined;
}> = [
  { intent: 'greeting', test: /^\s*(hello|hi|hey)\s+neuropause\s*[.!?]*\s*$/i },
  {
    intent: 'open-module',
    test: /\bopen\b|\bshow me\b|\bgo to\b|\btake me to\b/i,
    target: (t) => {
      if (/founder/i.test(t)) return 'ai-workforce/founder';
      if (/mission brief|brief|priorit/i.test(t)) return 'enterprise/briefings';
      if (/organi[sz]ation|org\b/i.test(t)) return 'enterprise/organization';
      if (/engineering/i.test(t)) return 'ai-workforce/engineering';
      if (/notification/i.test(t)) return 'notifications';
      if (/executive|dashboard|center/i.test(t)) return 'enterprise/executive';
      return undefined;
    },
  },
  {
    intent: 'action',
    test: /\b(create|make|add)\s+(a\s+)?task|schedule\s+(a\s+)?meeting|notify\s+(the\s+)?team|generate\s+(a\s+)?report|send\b/i,
    target: (t) => {
      if (/task/i.test(t)) return 'create-task';
      if (/meeting/i.test(t)) return 'schedule-meeting';
      if (/notify|team/i.test(t)) return 'notify-team';
      if (/report/i.test(t)) return 'generate-report';
      return 'unknown-action';
    },
  },
  {
    intent: 'engineering-health',
    test: /\bengineering\b.*(health|doing|status|how)|how.*\bengineering\b/i,
  },
  {
    intent: 'org-health',
    test: /\b(organi[sz]ation|org|company|business)\b.*(health|doing|status|how)|how.*\b(organi[sz]ation|company)\b/i,
  },
  {
    intent: 'decisions-pending',
    test: /decisions?.*(pending|open|waiting|to (make|decide))|pending decisions?|what needs (a )?decision/i,
  },
  {
    intent: 'decisions-recent',
    test: /(decided|decisions?).*(this week|today|recently|lately)|what did we decide/i,
  },
  {
    intent: 'fix-first',
    test: /\bfix first\b|\bfix\b.*\bfirst\b|highest priority|top priority|most urgent|what should i fix|biggest (risk|issue|problem)/i,
  },
  {
    intent: 'critical-risks',
    test: /\bcritical\b|\brisks?\b|\balerts?\b|what.*wrong|anything.*attention/i,
  },
  { intent: 'connector-status', test: /\bconnector/i },
  { intent: 'license-status', test: /\blicen[sc]e\b|\bsubscription\b|\bbilling\b/i },
  { intent: 'mission-brief', test: /\bbrief\b|\bpriorit/i },
  { intent: 'founder-recommendations', test: /\brecommend|\bsuggest|what should i|advice/i },
  {
    intent: 'summarize',
    test: /\bsummar(ize|y|ise)\b|\beverything\b|\boverview\b|\bcatch me up\b/i,
  },
];

/** Strip the wake phrase so "Hello NeuroPause, how is engineering?" classifies on the tail. */
function stripWake(transcript: string): string {
  if (/^\s*(hello|hi|hey)\s+neuropause\s*[.!?]*\s*$/i.test(transcript)) return transcript; // pure greeting
  return transcript
    .replace(WAKE, '')
    .replace(/^[,.\s]+/, '')
    .trim();
}

export function classifyVoiceIntent(transcript: string): VoiceIntentResult {
  const normalized = transcript.trim();
  const body = stripWake(normalized);

  for (const rule of RULES) {
    if (rule.test.test(body || normalized)) {
      const target = rule.target?.(body || normalized);
      // An 'open-module'/'action' whose target didn't resolve is lower-confidence.
      const confidence = rule.target && !target ? 0.5 : 0.85;
      return { intent: rule.intent, confidence, target, transcript: normalized };
    }
  }

  // No rule matched → hand to the existing Founder AI free-form path downstream.
  return { intent: 'unknown', confidence: 0.3, transcript: normalized };
}
