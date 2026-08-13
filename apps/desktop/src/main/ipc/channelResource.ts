/**
 * WHAT DOES THIS CHANNEL REACH? P13C ROUND 13 — PHASE 3.
 *
 * THE GAP THIS CLOSES, stated as the evidence that produced it.
 *
 * Every mechanism this program has built asks whether a channel IS CLASSIFIED.
 * `assertAllChannelsClassified` returns the channels that are neither gated nor
 * allowlisted. `channelsBothPublicAndGated` returns the ones that are both. The
 * family gates cross-check each other against the central table.
 *
 * None of them can ask whether a classification is CORRECT — whether the
 * authority on a channel matches the data its handler actually returns. So in
 * Round 12 a single sweep found FOURTEEN public channels carrying tenant data,
 * NINE of them one defect: a generator over the tenant corpus admitted as
 * "read-only", while the stored form of the identical rows was already gated.
 * Eleven rounds of review walked past them, because every automated check
 * answered a question that was not the question.
 *
 * This is the third time the program has hit that shape: data → authority
 * (Round 10), presence → attachment (Round 10), classified → correctly
 * classified (here). The pattern is a gate that checks PRESENCE where it needed
 * to check CORRESPONDENCE.
 *
 * THE MECHANISM
 *
 * A handler declares which STORE it reads or writes. The store already declares
 * its own scope and classification (`declareStoreScope`). Joining the two makes
 * the question mechanical:
 *
 *     channel → store → { scope, classification } + { public?, mutates? }
 *
 * and the rules below become checkable instead of reviewable.
 *
 * WHY A DECLARATION AND NOT A SOURCE SCAN. `storeScopeGate` can scan for
 * persistence because writing a file is syntactically visible. What a handler
 * REACHES is not: handlers close over injected ports, call through composition
 * roots, and reach stores several frames deep. A regex would produce confident
 * wrong answers, which is worse than no answer. So the link is declared, and the
 * cost of declaring it is one line beside a handler that already has an
 * authority decision written above it.
 *
 * WHAT THIS IS HONESTLY NOT, YET
 *
 * COVERAGE IS PARTIAL AND THE GAP IS THE POINT OF THIS PARAGRAPH. A channel with
 * no declaration is invisible to these rules — the mechanism proves things about
 * what it has been told, not about the whole surface. It is seeded here with the
 * channels this program has already had to reason about, so the rules are
 * exercised against real rows rather than fixtures, and every future sensitive
 * handler should add one line.
 *
 * That makes this a FORCING FUNCTION, not a proof of completeness — the same
 * status `storeScopeGate` states about itself. The round that calls it complete
 * is the round that gets the next fourteen.
 */
import type { IpcChannelName } from '@neuropause/shared';
import type { StoreScopeDeclaration } from '../tenancy/storeScope';

/** What a handler does to the resource it reaches. */
export type ChannelEffect = 'read' | 'mutate';

export interface ChannelResourceDeclaration {
  channel: IpcChannelName;
  /**
   * The `declareStoreScope` NAME of the store this handler reaches. Using the
   * store's own declared name rather than a path is what lets the join happen:
   * the scope and classification are read from the store's declaration, so this
   * side cannot disagree with it.
   */
  store: string;
  effect: ChannelEffect;
  /** Why this channel touches this store. One line; it is read during review. */
  reason: string;
}

const registry = new Map<IpcChannelName, ChannelResourceDeclaration>();

/** Declare which store a channel reaches. Call at module load, beside the handler. */
export function declareChannelResource(decl: ChannelResourceDeclaration): void {
  if (decl.store.trim() === '') {
    throw new Error(`Channel "${decl.channel}" must name the store it reaches.`);
  }
  if (decl.reason.trim() === '') {
    throw new Error(`Channel "${decl.channel}" must say WHY it reaches "${decl.store}".`);
  }
  registry.set(decl.channel, decl);
}

/** Every declaration, sorted. For the gate test and the coverage report. */
export function channelResourceDeclarations(): ChannelResourceDeclaration[] {
  return [...registry.values()].sort((a, b) => a.channel.localeCompare(b.channel));
}

/** Test seam. Never called in production. */
export function __resetChannelResourceRegistryForTests(): void {
  registry.clear();
}

export interface ChannelResourceViolation {
  channel: IpcChannelName;
  store: string;
  rule: string;
  detail: string;
}

/**
 * THE RULES. Each one is a finding this program actually shipped, made
 * unrepresentable rather than reviewable.
 *
 * 1. PUBLIC + CUSTOMER_DERIVED  → the Round 12 class, all fourteen of them.
 * 2. PUBLIC + mutate + INSTALL_GLOBAL   → the Round 11 updater / nps / pilot class.
 * 3. PUBLIC + mutate + PLATFORM_GLOBAL  → strictly worse than 2.
 * 4. PUBLIC + mutate + TENANT/WORKSPACE/USER → an unauthenticated write into a
 *    scoped store (`platform:emit`, Round 12).
 *
 * A read of INSTALL_METADATA stays legal and public — that is the standard the
 * codebase already argues for `plugins:list` and `registry:list`, and a rule
 * that banned it would push stores into declaring scopes they do not have.
 */
export function channelResourceViolations(
  publicChannels: ReadonlySet<IpcChannelName>,
  storeDeclarations: readonly StoreScopeDeclaration[],
): ChannelResourceViolation[] {
  const byName = new Map(storeDeclarations.map((d) => [d.name, d]));
  const out: ChannelResourceViolation[] = [];

  for (const decl of channelResourceDeclarations()) {
    if (!publicChannels.has(decl.channel)) continue;
    const store = byName.get(decl.store);
    if (!store) {
      out.push({
        channel: decl.channel,
        store: decl.store,
        rule: 'UNKNOWN_STORE',
        detail:
          `names a store with no \`declareStoreScope\`, so its scope and ` +
          `classification cannot be checked. A public channel reaching an ` +
          `unclassified store is the state this mechanism exists to refuse.`,
      });
      continue;
    }

    if (store.classification === 'CUSTOMER_DERIVED') {
      out.push({
        channel: decl.channel,
        store: decl.store,
        rule: 'PUBLIC_CUSTOMER_DERIVED',
        detail:
          `is PUBLIC and reaches CUSTOMER_DERIVED data. A public channel has no ` +
          `auth and no permission, so a signed-out renderer receives it. Gate it ` +
          `on the same authority the stored form of this data already carries.`,
      });
      continue;
    }

    if (decl.effect === 'mutate') {
      if (store.scope === 'INSTALL_GLOBAL' || store.scope === 'PLATFORM_GLOBAL') {
        out.push({
          channel: decl.channel,
          store: decl.store,
          rule: 'PUBLIC_GLOBAL_MUTATION',
          detail:
            `is PUBLIC and MUTATES a ${store.scope} store. One shared resource on ` +
            `the machine, changed by a caller who has not signed in.`,
        });
        continue;
      }
      if (store.scope === 'TENANT' || store.scope === 'WORKSPACE' || store.scope === 'USER') {
        out.push({
          channel: decl.channel,
          store: decl.store,
          rule: 'PUBLIC_SCOPED_MUTATION',
          detail:
            `is PUBLIC and MUTATES a ${store.scope} store. An unauthenticated ` +
            `caller must not author rows into a scoped store — the owner would be ` +
            `stamped from whatever context happened to be active.`,
        });
      }
    }
  }
  return out;
}

/**
 * Composition-time assertion. Throws rather than warns, for the reason
 * `declareStoreScope` gives: a warning in a startup log is a thing nobody reads
 * until after the incident.
 */
export function assertChannelResourceSafety(
  publicChannels: ReadonlySet<IpcChannelName>,
  storeDeclarations: readonly StoreScopeDeclaration[],
): void {
  const violations = channelResourceViolations(publicChannels, storeDeclarations);
  if (violations.length === 0) return;
  throw new Error(
    `These PUBLIC channels reach data their classification does not permit:\n` +
      violations.map((v) => `  ${v.channel} → ${v.store} [${v.rule}] ${v.detail}`).join('\n'),
  );
}
