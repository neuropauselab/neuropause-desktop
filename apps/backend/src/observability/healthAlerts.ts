/**
 * Edge-triggered health alerting (TD-6, first operational slice).
 *
 * The backend already computes dependency health on every `/health` poll. This
 * module turns that polled signal into ALERTS that fire only on a state CHANGE
 * (up->down or down->up), so a sustained outage does not spam. Each transition
 * is recorded as a counter (`neuropause_health_alerts_total`, alertable in
 * Prometheus) and a structured log line, and is dispatched to any registered
 * external sinks (e.g. a webhook/pager integration wired in the composition
 * root). No new dependency and no framework — a tiny in-process detector that
 * mirrors the minimal `metrics.ts` registry.
 *
 * Honest limitations: state is per backend instance (not shared), and detection
 * latency equals the `/health` poll interval. This is a first slice — routing to
 * a specific external destination is done by registering a sink; none is wired
 * by default (the default behaviour is the structured log + metric).
 */
import { logger } from '../config/logger';
import { recordHealthAlert } from './metrics';

export type ComponentState = 'up' | 'down';

export interface HealthAlert {
  /** The monitored component, e.g. 'database' or 'redis'. */
  component: string;
  /** The NEW state the component just transitioned to. */
  state: ComponentState;
  /** ISO-8601 timestamp of the transition. */
  at: string;
}

export type AlertSink = (alert: HealthAlert) => void;

/** Last observed state per component; a change from this fires an alert. */
const lastState = new Map<string, ComponentState>();
/** Registered external destinations. The log + metric always run regardless. */
const sinks: AlertSink[] = [];

/**
 * Register an external alert destination (webhook, pager, chat). Sinks are
 * best-effort: a throwing sink is logged and never breaks health handling.
 */
export function registerAlertSink(sink: AlertSink): void {
  sinks.push(sink);
}

/**
 * Report the current state of a monitored component. Fires an alert ONLY when
 * the state differs from the last observation (edge-triggered). The first-ever
 * observation of `up` is treated as the healthy baseline and does not alert; a
 * first observation of `down` does alert.
 */
export function reportComponentHealth(component: string, state: ComponentState): void {
  const prev = lastState.get(component);
  if (prev === state) return; // no change -> no alert (prevents outage spam)
  lastState.set(component, state);
  if (prev === undefined && state === 'up') return; // baseline healthy -> silent

  const alert: HealthAlert = { component, state, at: new Date().toISOString() };
  recordHealthAlert(component, state);
  if (state === 'down') {
    logger.error(alert, `Health alert: ${component} is DOWN`);
  } else {
    logger.warn(alert, `Health recovery: ${component} is back UP`);
  }
  for (const sink of sinks) {
    try {
      sink(alert);
    } catch (err) {
      logger.error({ err, component }, 'Health alert sink threw');
    }
  }
}

/** Report a full component snapshot at once (e.g. from the `/health` handler). */
export function reportHealthSnapshot(components: Record<string, ComponentState>): void {
  for (const [component, state] of Object.entries(components)) {
    reportComponentHealth(component, state);
  }
}

/** Test helper — clears observed state and registered sinks. */
export function resetHealthAlerts(): void {
  lastState.clear();
  sinks.length = 0;
}
