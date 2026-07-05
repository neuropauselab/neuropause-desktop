/**
 * Voice response composer (V2.6).
 *
 * Pure function: (classified intent + the EXISTING Executive Center snapshot) →
 * a spoken VoiceResponse. It reads real evidence from the snapshot the V2.4 layer
 * already composes (KPIs, org-health scores, critical alerts, founder recs) and
 * phrases it for speech. It fabricates nothing — an empty snapshot yields honest
 * "nothing to report" phrasing. Free-form ('unknown') is delegated upstream to the
 * existing Founder AI, so this composer only handles the routed intents.
 */
import type {
  ExecutiveCenterSnapshot,
  VoiceIntent,
  VoiceIntentResult,
  VoiceResponse,
} from '@neuropause/shared';

/** Optional greeting name (from settings/profile); kept generic when absent. */
export interface VoiceComposerContext {
  displayName?: string;
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
}

function greeting(ctx: VoiceComposerContext): string {
  const part = ctx.timeOfDay ? `Good ${ctx.timeOfDay}` : 'Hello';
  return ctx.displayName ? `${part}, ${ctx.displayName}.` : `${part}.`;
}

function band(score: number): string {
  if (score >= 80) return 'healthy';
  if (score >= 60) return 'a watch';
  if (score >= 40) return 'at risk';
  return 'critical';
}

/**
 * Compose the spoken response for a routed intent. `snapshot` is the live
 * Executive Center snapshot; `founderFallback` is the phrase to speak for
 * free-form questions the router couldn't map (produced upstream by Founder AI).
 */
export function composeVoiceResponse(
  result: VoiceIntentResult,
  snapshot: ExecutiveCenterSnapshot | null,
  ctx: VoiceComposerContext = {},
  founderFallback?: string,
): VoiceResponse {
  const intent: VoiceIntent = result.intent;

  // Intents that don't need the snapshot.
  if (intent === 'greeting') {
    const attention = snapshot?.attentionCounts;
    const tail =
      attention && attention.critical > 0
        ? ` You have ${attention.critical} critical item${attention.critical === 1 ? '' : 's'} to review.`
        : ' Everything looks steady.';
    return { speech: `${greeting(ctx)}${snapshot ? tail : ''}`, intent };
  }
  if (intent === 'open-module') {
    return {
      speech: result.target ? 'Opening that now.' : "I'm not sure which module you meant.",
      intent,
      deepLink: result.target,
    };
  }
  if (intent === 'action') {
    return {
      speech: `I can do that, but it needs your approval first. Shall I ${describeAction(result.target)}?`,
      intent,
      actionId: result.target,
      requiresApproval: true, // every state-changing action passes governance
    };
  }
  if (intent === 'unknown') {
    return {
      speech:
        founderFallback ??
        "I didn't catch a request I can answer yet. Try asking about engineering, organization health, or your brief.",
      intent,
    };
  }

  // Snapshot-backed intents.
  if (!snapshot) {
    return { speech: "I don't have live intelligence to report just yet.", intent };
  }
  const s = snapshot;

  switch (intent) {
    case 'org-health': {
      const v = s.orgHealth.overall;
      return {
        speech: `Organization health is ${v} out of 100 — ${band(v)}.`,
        intent,
        deepLink: 'enterprise/organization',
      };
    }
    case 'engineering-health': {
      const v = s.orgHealth.engineering;
      return {
        speech: `Engineering health is ${v} out of 100 — ${band(v)}.`,
        intent,
        deepLink: 'ai-workforce/engineering',
      };
    }
    case 'critical-risks': {
      const n = s.attentionCounts.critical;
      const speech =
        n === 0
          ? 'No critical risks right now.'
          : `There ${n === 1 ? 'is' : 'are'} ${n} critical risk${n === 1 ? '' : 's'}. ${topItem(s.criticalAlerts.items)}`;
      return { speech, intent, deepLink: 'notifications' };
    }
    case 'connector-status': {
      const kpi = s.kpis.find((k) => k.key === 'connector-health');
      return {
        speech: kpi ? `Connectors: ${kpi.display}.` : 'Connector status is unavailable.',
        intent,
        deepLink: 'connectors',
      };
    }
    case 'license-status': {
      const kpi = s.kpis.find((k) => k.key === 'license-status');
      return {
        speech: kpi ? `License status: ${kpi.display}.` : 'License status is unavailable.',
        intent,
        deepLink: 'settings/billing',
      };
    }
    case 'mission-brief': {
      const items = s.upcomingPriorities.items;
      return {
        speech:
          items.length === 0
            ? 'Nothing urgent on your brief right now.'
            : `Your top priority: ${items[0].title}.`,
        intent,
        deepLink: 'enterprise/briefings',
      };
    }
    case 'founder-recommendations': {
      // V3.2: prefer the ranked recommendation engine; fall back to founder items.
      const top = s.recommendations?.[0];
      if (top) {
        return {
          speech: `I recommend: ${top.recommendedAction} (${top.problem})`,
          intent,
          deepLink: 'enterprise/executive',
        };
      }
      const items = s.founderRecommendations.items;
      return {
        speech:
          items.length === 0
            ? 'No recommendations at the moment.'
            : `I recommend: ${items[0].title}.`,
        intent,
        deepLink: 'ai-workforce/founder',
      };
    }
    case 'fix-first': {
      // V3.2: answer "what should I fix first?" / "biggest risk" from the engine.
      const top = s.recommendations?.[0];
      if (!top) {
        return {
          speech: 'Nothing needs fixing right now — metrics are healthy.',
          intent,
          deepLink: 'enterprise/executive',
        };
      }
      return {
        speech: `Fix this first: ${top.problem} ${top.recommendedAction} Business impact: ${top.businessImpact}`,
        intent,
        deepLink: 'enterprise/executive',
      };
    }
    case 'summarize': {
      // V3.2: lead with the executive summary when available.
      const sum = s.executiveSummary;
      if (sum) {
        return {
          speech: `Executive score ${sum.executiveScore}. Top risk: ${sum.topRisk}. Top recommendation: ${sum.topRecommendation}.`,
          intent,
          deepLink: 'enterprise/executive',
        };
      }
      const a = s.attentionCounts;
      return {
        speech: `Here's the overview. Organization health ${s.orgHealth.overall}, engineering ${s.orgHealth.engineering}. ${a.critical} critical and ${a.high} high-priority item${a.high === 1 ? '' : 's'} need attention.`,
        intent,
        deepLink: 'enterprise/executive',
      };
    }
    default:
      return {
        speech: 'I can report on engineering, organization health, risks, or your brief.',
        intent,
      };
  }
}

function topItem(items: { title: string }[]): string {
  return items.length > 0 ? `The most urgent is: ${items[0].title}.` : '';
}

function describeAction(target: string | undefined): string {
  switch (target) {
    case 'create-task':
      return 'create the task';
    case 'schedule-meeting':
      return 'schedule the meeting';
    case 'notify-team':
      return 'notify the team';
    case 'generate-report':
      return 'generate the report';
    default:
      return 'proceed';
  }
}
