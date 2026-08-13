/**
 * Identity — subsystem composition + IPC.
 *
 * Three things, and the reason each is here rather than somewhere else:
 *
 *  1. THE MATCH QUEUE IS ANSWERABLE. Program 9's bridge detected ambiguous
 *     rows, counted them in a sync summary, and dropped them — so nobody was
 *     ever asked and the data never arrived. Confirming a match here does the
 *     thing the sync refused to do: it links, and it fills only what is empty.
 *  2. EXTERNAL IDENTITIES ARE EXPLAINABLE. Every link carries its evidence, who
 *     confirmed it and when. Unlinking removes the association and keeps both
 *     sides, because the record's provenance still has to be readable.
 *  3. A SERVICE HAS ITS OWN AUTHORITY. `authorizeAs` is the seam: a background
 *     sync runs as a named service with an explicit scope list, not as
 *     whichever human happened to be signed in and not with no permissions at
 *     all. Both of those were the state before.
 *
 * WORKSPACE IS THE OUTER BOUNDARY on every handler. An identity raised in one
 * workspace cannot be listed, confirmed or unlinked from another.
 */
import { join } from 'node:path';
import type {
  EnterpriseModuleDescriptor,
  EnterprisePermission,
  ExternalIdentity,
  IdentityMatch,
  IdentitySubject,
  ServiceIdentity,
} from '@neuropause/shared';
import type {
  IdentityConfirmRequest as IdentityConfirmRequestType,
  IdentityListRequest as IdentityListRequestType,
  IdentityQueueRequest as IdentityQueueRequestType,
  IdentityServiceStatusRequest as IdentityServiceStatusRequestType,
  IdentityUnlinkRequest as IdentityUnlinkRequestType,
} from '@neuropause/shared';
import {
  EmptyRequest,
  IdentityConfirmRequest,
  IdentityListRequest,
  IdentityQueueRequest,
  IdentityServiceStatusRequest,
  IdentityUnlinkRequest,
  IpcChannel,
  REDACTED_MARKER,
  classifyField,
  describeActor,
  validateEnterpriseRecordInput,
} from '@neuropause/shared';
import type { SecureHandlerDef } from '../ipc/secureBridge';
import type { EnterpriseRecordStore } from '../enterprise/framework/enterpriseRecordStore';
import type { ProvenanceRecord, ProvenanceStore } from '../dataPlane/importer';
import { createLogger } from '../logger';
import { IdentityStore } from './identityStore';

const log = createLogger('identity');

export interface IdentitySubsystemDeps {
  userDataDir: string;
  /** The boundary. Every handler scopes to this. */
  workspaceId: () => string;
  actor: () => string | null;
  now: () => string;
  audit: (entry: { action: string; target: string; summary: string }) => void;
  /** Non-throwing check for the signed-in human. */
  allows: (permission: EnterprisePermission) => boolean;
  /** Throwing gate, for a person's own consequential action. */
  authorize: (permission: EnterprisePermission) => void;
  modules: () => readonly EnterpriseModuleDescriptor[];
  storeFor: (moduleId: string) => EnterpriseRecordStore | null;
  /**
   * The SAME provenance store the connector bridge and the file importer use.
   *
   * Load-bearing, not bookkeeping. The bridge's only idempotency source is
   * `provenance.forExternalKey(...)`; a decision that does not write one is a
   * decision the next sync cannot see, so the question comes back minutes later
   * and the provider's future updates never reach the record that was linked.
   * Answering has to leave a mark in the place the sync actually looks.
   */
  provenance: ProvenanceStore;
  /** The same lifecycle fan-out an import fires, so a linked record connects. */
  onImported: (event: {
    moduleId: string;
    recordIds: string[];
    planId: string;
    correlationId: string;
  }) => void;
}

export interface IdentitySubsystem {
  handlers: SecureHandlerDef[];
  store: IdentityStore;
  /**
   * Has a person already ruled on this provider object?
   *
   * The bridge asks before raising, because "not a match" must be DURABLE.
   * Rejecting writes no record and therefore no provenance, so provenance —
   * the bridge's only other memory — cannot answer this. Without the probe the
   * next sync tick re-raises the identical question and the person's answer
   * lasts about a minute.
   */
  decidedAlready: (input: {
    provider: string;
    connectionId: string;
    providerEntityType: string;
    providerEntityId: string;
  }) => boolean;
  /**
   * Register a service principal and return an authorizer bound to it.
   *
   * This is the answer to "who is the scheduled sync?". It holds the scopes the
   * declaration gives it and nothing else — no union with a human's roles, no
   * inheritance from an administrator who happens to be signed in.
   */
  serviceAuthorizer: (input: {
    id: string;
    purpose: string;
    permissions: EnterprisePermission[];
  }) => ServiceAuthorizer;
}

export interface ServiceAuthorizer {
  /** The declared id, stable across workspaces. */
  serviceId: string;
  /** The per-workspace principal actually acting, or null with no workspace. */
  rowId: () => string | null;
  /**
   * Resolves once this service's row is readable.
   *
   * Awaited before the work starts, so `allows` never has to answer from an
   * unloaded store — see the note on `allows` for what that used to cost.
   */
  ready: () => Promise<void>;
  /** Whether this service holds a permission. Pure. */
  allows: (permission: EnterprisePermission) => boolean;
  /** The actor string to record, which always names it as a service. */
  actor: () => string;
  /**
   * Record that it acted, for the health surface.
   *
   * Returns the promise so a caller that needs the row on disk — a test, or a
   * shutdown path — can wait for it. Callers in the hot path ignore it: a
   * failed bookkeeping write must never fail the work it describes.
   */
  note: (action: string) => Promise<void>;
}

export function initIdentity(deps: IdentitySubsystemDeps): IdentitySubsystem {
  const store = new IdentityStore(join(deps.userDataDir, 'identity.json'), deps.now);

  const descriptorFor = (moduleId: string): EnterpriseModuleDescriptor | null =>
    deps.modules().find((m) => m.id === moduleId) ?? null;

  const serviceAuthorizer = (input: {
    id: string;
    purpose: string;
    permissions: EnterprisePermission[];
  }): ServiceAuthorizer => {
    const granted = new Set(input.permissions);
    /**
     * One service ROW per workspace, from one declaration.
     *
     * The alternative — a single row whose `workspaceId` is whichever workspace
     * happened to be active at boot — makes the field decorative: after a
     * workspace switch the same principal is either acting outside its
     * workspace or refusing to act at all. Splitting the row means a service
     * declared once can act in each workspace under a DISTINCT principal, with
     * its own usage history and its own off switch, and can never carry
     * workspace A's authority into workspace B.
     */
    const rowIdFor = (workspaceId: string): string => `${input.id}@${workspaceId}`;
    /**
     * The registration promise per workspace, not a boolean.
     *
     * `note` used to fire immediately after `ensure` and find no row, because
     * registration had not resolved yet — so the health surface said "never
     * acted" about a service that had just acted. Keeping the promise lets a
     * note queue behind the registration that creates the row it belongs to.
     */
    const registered = new Map<string, Promise<void>>();

    const ensure = (workspaceId: string): Promise<void> => {
      const rowId = rowIdFor(workspaceId);
      let pending = registered.get(rowId);
      if (pending === undefined) {
        // Persistence is for the audit and health surfaces. The DECISION below
        // comes from the declaration, so a slow or failed write cannot silently
        // widen or narrow what this service may do.
        pending = store
          .registerService({
            id: rowId,
            purpose: input.purpose,
            permissions: input.permissions,
            workspaceId,
          })
          .then(() => undefined)
          .catch(() => undefined);
        registered.set(rowId, pending);
      }
      return pending;
    };

    return {
      serviceId: input.id,
      rowId: () => {
        const workspaceId = deps.workspaceId();
        return workspaceId === '' ? null : rowIdFor(workspaceId);
      },
      ready: async () => {
        const workspaceId = deps.workspaceId();
        if (workspaceId === '') return;
        await store.load();
        await ensure(workspaceId);
      },
      allows: (permission) => {
        const workspaceId = deps.workspaceId();
        // No active workspace means no workspace to act in. Fail closed rather
        // than pick one.
        if (workspaceId === '') return false;
        /**
         * FAIL CLOSED WHILE THE STORE IS UNREAD.
         *
         * `serviceById` reads an in-memory list that starts empty, and an empty
         * list is indistinguishable from "no such service" — so the FIRST check
         * of every process used to sail past a service an operator had stopped,
         * and a full sync batch got written on the next launch. An absence is
         * not an all-clear. Callers await `ready()` first, so this branch is a
         * backstop rather than the normal path.
         */
        if (!store.isLoaded()) return false;
        void ensure(workspaceId);
        const service = store.serviceById(rowIdFor(workspaceId));
        // A disabled service holds nothing. Read live so an operator can stop
        // it without a restart.
        if (service !== null && service.status === 'disabled') return false;
        return granted.has(permission);
      },
      actor: () =>
        describeActor({ kind: 'service', id: input.id, label: input.purpose }),
      note: async (action) => {
        const workspaceId = deps.workspaceId();
        if (workspaceId === '') return;
        // Chained behind registration so the very FIRST action is recorded,
        // rather than lost against a row that did not exist yet — which made
        // the health surface report "never acted" about a service that had.
        await ensure(workspaceId);
        store.noteServiceUse(rowIdFor(workspaceId), action);
        await store.flush();
      },
    };
  };

  /**
   * `connectorId::accountId::resourceId::externalId` — the bridge's own key.
   *
   * Identical by construction, because a key that merely looks the same is a
   * key the sync will miss. `IdentityMatch` names the same four things in its
   * own vocabulary; this is the translation, in one place.
   */
  const externalKeyOf = (match: IdentityMatch): string =>
    `${match.provider}::${match.connectionId}::${match.providerEntityType}::${match.providerEntityId}`;

  /**
   * Write the provenance a decision produces.
   *
   * `linkage` is what makes a later sync behave correctly: `adopted` means the
   * record was already here and a sync may only fill gaps, `created` means the
   * connector produced it and a sync may update every mapped field. Confirming
   * is adoption by definition — a person just said the record predates the
   * provider's claim on it.
   */
  const recordProvenance = async (
    match: IdentityMatch,
    recordId: string,
    linkage: 'created' | 'adopted',
    at: string,
    actor: string,
  ): Promise<void> => {
    const provenance: ProvenanceRecord = {
      recordId,
      moduleId: match.destinationModuleId,
      planId: `identity_${match.id}`,
      sourceFile: `${match.provider} (${match.providerEntityType})`,
      sourceTable: match.providerEntityType,
      sourceRow: 1,
      // A person decided this. Not a similarity score dressed as one.
      confidence: 1,
      approvedBy: actor,
      importedAt: at,
      fields: [],
      connector: {
        connectorId: match.provider,
        accountId: match.connectionId,
        resourceId: match.providerEntityType,
        externalId: match.providerEntityId,
        externalKey: externalKeyOf(match),
        externalUpdatedAt: null,
        syncRunId: `identity_${match.id}`,
        mappingVersion: 0,
        linkage,
      },
    };
    await deps.provenance.appendConnector([provenance]);
  };

  /**
   * Mask a protected value for display, keeping "present" distinguishable from
   * "empty" — which is the only property the decision actually needs.
   */
  const maskValue = (moduleId: string, field: string, label: string, value: string): string => {
    /**
     * The DECLARED class can only raise, never lower.
     *
     * Name matching alone is a hand-maintained deny-list across a hundred-odd
     * modules, and the miss is silent. Every other redacting surface in the app
     * goes through `classifyField` so a module that declares a field sensitive is
     * respected even when its name looks innocuous; this one used to be the
     * exception, which is the worst kind — the redaction marker elsewhere on the
     * card implies the rest was checked.
     */
    const declared = descriptorFor(moduleId)?.fields.find((f) => f.key === field)?.sensitive;
    if (classifyField({ key: field, label, sensitive: declared }) === 'normal') return value;
    return value === '' ? '' : REDACTED_MARKER;
  };

  /**
   * The queue as it leaves the main process, with sensitive values masked.
   *
   * The bridge maps whatever the provider sent, which for a contact already
   * includes an email and a phone number and could — if a mapping is widened —
   * include something the sensitivity rules class as restricted. A screen whose
   * job is "look at these two values and decide" must not become the one place a
   * protected value is rendered in the clear.
   *
   * THREE places carry values and all three are masked: the incoming list, each
   * candidate's `differs` (both sides — the existing value is as protected as the
   * new one), and any evidence that quoted a value. Masking one and forgetting
   * another would be worse than not masking at all, because the redaction marker
   * elsewhere on the card implies the rest was checked.
   *
   * Done at the boundary rather than in the component, so a second consumer of
   * this channel cannot get the unmasked version by not knowing to mask.
   */
  const queueView = (match: IdentityMatch): IdentityMatch => ({
    ...match,
    incoming: match.incoming.map((f) => ({
      ...f,
      value: maskValue(match.destinationModuleId, f.field, f.label, f.value),
    })),
    candidates: match.candidates.map((c) => ({
      ...c,
      evidence: c.evidence.map((e) => ({
        ...e,
        value: e.value === null ? null : maskValue(match.destinationModuleId, e.field, e.field, e.value),
      })),
      differs: c.differs.map((d) => ({
        ...d,
        existing: maskValue(match.destinationModuleId, d.field, d.label, d.existing),
        incoming: maskValue(match.destinationModuleId, d.field, d.label, d.incoming),
      })),
    })),
  });

  /**
   * Whether the caller may read a module's records at all.
   *
   * The NON-throwing probe on purpose: `deps.authorize` opens a HOLD and writes
   * a Decision Record on refusal, and a person merely opening a tab that happens
   * to include one module they cannot see has not done anything worth recording.
   */
  const canRead = (moduleId: string): boolean => {
    const descriptor = descriptorFor(moduleId);
    // A module that is not in this build cannot be read, and cannot be leaked
    // by defaulting to "allowed".
    return descriptor !== null && deps.allows(descriptor.permissions.read);
  };

  /** See `IdentitySubsystem.decidedAlready`. */
  const decidedAlready = (input: {
    provider: string;
    connectionId: string;
    providerEntityType: string;
    providerEntityId: string;
  }): boolean => {
    // Not loaded means "I do not know", and "I do not know" must not read as
    // "nobody has decided" — that would re-raise every answered question once
    // per restart. Asking again is the safe error here, so an unloaded store
    // returns false only because the caller re-checks after load; see the
    // `void store.load()` at the end of this function.
    const identity = store.identityFor(
      deps.workspaceId(),
      input.provider,
      input.connectionId,
      input.providerEntityType,
      input.providerEntityId,
    );
    if (identity === null) return false;
    return identity.evidence.some((e) => e.kind === 'human_decision');
  };

  const handlers: SecureHandlerDef[] = [
    {
      channel: IpcChannel.IdentityQueue,
      schema: IdentityQueueRequest,
      requireAuth: true,
      handler: async (p): Promise<IdentityMatch[]> => {
        const req = p as IdentityQueueRequestType;
        deps.authorize('data:read');
        await store.load();
        /**
         * `data:read` is not enough on its own.
         *
         * A question carries the DESTINATION MODULE'S CURRENT FIELD VALUES in
         * `differs`, plus its record titles. Gating only on `data:read` made this
         * channel a way around the per-module read scope the on-screen view
         * enforces — a custom role holding `data:read` without `crm:read` could
         * read customer field values out of the identity queue. Filtered rather
         * than refused, with the non-throwing probe: one inaccessible module must
         * not take the whole queue down with it.
         */
        return store
          .queue(deps.workspaceId(), req.limit ?? 200)
          .filter((m) => canRead(m.destinationModuleId))
          .map(queueView);
      },
    },
    {
      channel: IpcChannel.IdentityList,
      schema: IdentityListRequest,
      requireAuth: true,
      handler: async (p): Promise<ExternalIdentity[]> => {
        const req = p as IdentityListRequestType;
        deps.authorize('data:read');
        await store.load();
        const all = store
          .listIdentities(deps.workspaceId(), req.limit ?? 200)
          // Same reasoning as the queue: `subject.label` is a record title.
          .filter((i) => i.subject === null || canRead(i.subject.scopeId))
          // Same masking as the queue. An identity's stored evidence can quote
          // the value it matched on, and this list is the long-lived surface —
          // the one most likely to be screen-shared.
          .map((identity) => ({
            ...identity,
            evidence: identity.evidence.map((e) => ({
              ...e,
              value:
                e.value === null
                  ? null
                  : maskValue(identity.subject?.scopeId ?? '', e.field, e.field, e.value),
            })),
          }));
        return req.subjectId === undefined ? all : all.filter((i) => i.subject?.id === req.subjectId);
      },
    },
    {
      /**
       * Answer an identity question.
       *
       * `data:approve` and not `data:import`: deciding that a provider's object
       * IS an existing customer changes what that customer means. It is the
       * same class of act as approving a high-risk import, and the existing
       * separation-of-duties split already names that scope.
       */
      channel: IpcChannel.IdentityConfirm,
      schema: IdentityConfirmRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<{ ok: boolean; message: string; recordId: string | null }> => {
        const req = p as IdentityConfirmRequestType;
        deps.authorize('data:approve');
        await store.load();

        const workspaceId = deps.workspaceId();
        // Read from the store, NOT from whatever the queue rendered: the queue
        // masks sensitive values for display, and writing the mask back would
        // replace a real phone number with bullet characters.
        const match = store.matchById(workspaceId, req.matchId);
        if (!match) {
          return { ok: false, message: 'That identity question no longer exists.', recordId: null };
        }

        const descriptor = descriptorFor(match.destinationModuleId);
        if (!descriptor) {
          return { ok: false, message: `“${match.destinationModuleId}” is not a module in this build.`, recordId: null };
        }
        /**
         * Writing the record needs the module's OWN write scope, on top of
         * `data:approve`. Deciding an identity and writing to a module are two
         * different authorities and both are required.
         */
        deps.authorize(descriptor.permissions.write);

        const recordStore = deps.storeFor(match.destinationModuleId);
        if (!recordStore) {
          return { ok: false, message: `“${descriptor.title}” is not available in this build.`, recordId: null };
        }
        await recordStore.load();
        const actor = deps.actor() ?? 'unknown';
        const at = deps.now();

        if (req.decision === 'reject') {
          await store.upsertIdentity({
            workspaceId,
            provider: match.provider,
            connectionId: match.connectionId,
            providerAccountId: null,
            providerEntityType: match.providerEntityType,
            providerEntityId: match.providerEntityId,
            displayName: match.incomingLabel,
            email: match.incoming.find((f) => f.field === 'email')?.value ?? null,
            // Rejected is `unknown`, not a state of its own: the provider row
            // exists and is linked to nothing, which is exactly `unknown`.
            state: 'unknown',
            subject: null,
            evidence: [
              {
                kind: 'human_decision',
                field: 'identity',
                value: null,
                detail: `${actor} decided this is none of the offered records.`,
              },
            ],
            confirmedBy: actor,
          });
          await store.retireMatch(workspaceId, match.id);
          deps.audit({
            action: 'identity.rejected',
            target: `${match.provider}:${match.providerEntityType}:${match.providerEntityId}`,
            summary: `${actor} rejected every match for “${match.incomingLabel}”. It stays unlinked.`,
          });
          return { ok: true, message: 'Left unlinked.', recordId: null };
        }

        if (req.decision === 'create_new') {
          const fields: Record<string, string | number | boolean | null> = {};
          for (const field of match.incoming) fields[field.field] = field.value;
          const validated = validateEnterpriseRecordInput(descriptor, {
            title: match.incomingLabel,
            fields,
          });
          if (!validated.ok) {
            return {
              ok: false,
              message: Object.entries(validated.errors)
                .map(([field, message]) => `${field}: ${message}`)
                .join(' '),
              recordId: null,
            };
          }
          const created = recordStore.create({
            title: match.incomingLabel,
            fields: validated.values,
            actor,
            now: at,
          });
          await recordStore.flush();

          await store.upsertIdentity({
            workspaceId,
            provider: match.provider,
            connectionId: match.connectionId,
            providerAccountId: null,
            providerEntityType: match.providerEntityType,
            providerEntityId: match.providerEntityId,
            displayName: match.incomingLabel,
            email: match.incoming.find((f) => f.field === 'email')?.value ?? null,
            state: 'known',
            subject: {
              kind: 'record',
              scopeId: match.destinationModuleId,
              id: created.id,
              label: created.title,
            },
            evidence: [
              {
                kind: 'human_decision',
                field: 'identity',
                value: null,
                detail: `${actor} decided this is a new ${descriptor.singular.toLowerCase()}.`,
              },
            ],
            confirmedBy: actor,
          });
          await store.retireMatch(workspaceId, match.id);
          // `created`: the connector produced this record, so a later sync owns
          // its mapped fields — and finds it by external key rather than
          // creating a second one.
          await recordProvenance(match, created.id, 'created', at, actor);
          // The same fan-out an import fires, so the new record connects.
          deps.onImported({
            moduleId: match.destinationModuleId,
            recordIds: [created.id],
            planId: `identity_${match.id}`,
            correlationId: `identity_${match.id}`,
          });
          deps.audit({
            action: 'identity.created',
            target: `${match.provider}:${match.providerEntityType}:${match.providerEntityId}`,
            summary: `${actor} created ${descriptor.singular} “${created.title}” for “${match.incomingLabel}”.`,
          });
          return { ok: true, message: `Created ${created.title}.`, recordId: created.id };
        }

        /* ── confirm ─────────────────────────────────────────────────────── */
        const candidate = match.candidates.find((c) => c.subject.id === req.subjectId);
        if (!candidate) {
          return { ok: false, message: 'That record is not one of the offered matches.', recordId: null };
        }
        const record = recordStore.get(candidate.subject.id);
        if (!record || record.status === 'deleted') {
          return { ok: false, message: 'That record no longer exists.', recordId: null };
        }

        /**
         * FILL ONLY WHAT IS EMPTY.
         *
         * Confirming an identity is not permission to overwrite the record. The
         * values already in it may be somebody's correction, and a merge that
         * silently replaces them is the failure the whole ambiguity gate exists
         * to prevent. The differences were shown before the click; the ones the
         * person is accepting are the blanks.
         */
        const patch: Record<string, string | number | boolean | null> = {};
        for (const field of match.incoming) {
          const current = record.fields[field.field];
          if (current === undefined || current === null || String(current).trim() === '') {
            patch[field.field] = field.value;
          }
        }
        if (Object.keys(patch).length > 0) {
          /**
           * The merged record goes through the SAME validator an import uses.
           *
           * Filling a blank is still a write, and a provider is perfectly
           * capable of supplying a malformed email for a field that happened to
           * be empty. Validating here also applies the descriptor's coercions
           * and defaults, so a confirmed record is indistinguishable from an
           * imported one rather than a second, laxer way in.
           */
          const merged = validateEnterpriseRecordInput(descriptor, {
            title: record.title,
            fields: { ...record.fields, ...patch },
          });
          if (!merged.ok) {
            return {
              ok: false,
              message:
                `Linking would put an invalid value on ${record.title}: ` +
                Object.entries(merged.errors)
                  .map(([field, message]) => `${field}: ${message}`)
                  .join(' '),
              recordId: null,
            };
          }
          recordStore.update(record.id, { fields: merged.values, actor, now: at });
          await recordStore.flush();
        }

        const identity = await store.upsertIdentity({
          workspaceId,
          provider: match.provider,
          connectionId: match.connectionId,
          providerAccountId: null,
          providerEntityType: match.providerEntityType,
          providerEntityId: match.providerEntityId,
          displayName: match.incomingLabel,
          email: match.incoming.find((f) => f.field === 'email')?.value ?? null,
          state: 'known',
          subject: candidate.subject,
          evidence: [
            ...candidate.evidence,
            {
              kind: 'human_decision',
              field: 'identity',
              value: null,
              detail: `${actor} confirmed this is ${candidate.subject.label}.`,
            },
          ],
          confirmedBy: actor,
        });
        await store.retireMatch(workspaceId, match.id);
        // `adopted`: the record predates the provider's claim on it, so a later
        // sync fills gaps and never overwrites. Without this the sync cannot see
        // the answer and re-raises the same question on its next tick.
        await recordProvenance(match, record.id, 'adopted', at, actor);
        deps.onImported({
          moduleId: match.destinationModuleId,
          recordIds: [record.id],
          planId: `identity_${match.id}`,
          correlationId: `identity_${match.id}`,
        });
        deps.audit({
          action: 'identity.confirmed',
          target: `${match.provider}:${match.providerEntityType}:${match.providerEntityId}`,
          summary:
            `${actor} confirmed “${match.incomingLabel}” is ${descriptor.singular} “${record.title}”` +
            `${Object.keys(patch).length > 0 ? `; filled ${Object.keys(patch).length} empty field(s)` : '; nothing was overwritten'}.`,
        });
        log.info('Identity confirmed', { identityId: identity.id, provider: match.provider });
        return { ok: true, message: `Linked to ${record.title}.`, recordId: record.id };
      },
    },
    {
      /**
       * Break an association without deleting either side.
       *
       * The canonical record stays, the external identity stays, and the
       * history of having been linked stays — that history is part of how the
       * record's provenance reads.
       */
      channel: IpcChannel.IdentityUnlink,
      schema: IdentityUnlinkRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<{ ok: boolean; message: string }> => {
        const req = p as IdentityUnlinkRequestType;
        deps.authorize('data:approve');
        await store.load();
        const workspaceId = deps.workspaceId();
        const before = store.listIdentities(workspaceId, 100_000).find((i) => i.id === req.identityId);
        const identity = await store.unlink(workspaceId, req.identityId);
        if (!identity) return { ok: false, message: 'No such identity in this workspace.' };
        deps.audit({
          action: 'identity.unlinked',
          target: `${identity.provider}:${identity.providerEntityType}:${identity.providerEntityId}`,
          summary: `${deps.actor() ?? 'unknown'} unlinked “${identity.displayName}” from ${before?.subject?.label ?? 'its record'}${req.reason ? ` — ${req.reason}` : ''}. Both were kept.`,
        });
        return { ok: true, message: 'Unlinked. Neither side was deleted.' };
      },
    },
    {
      channel: IpcChannel.IdentityServices,
      schema: EmptyRequest,
      requireAuth: true,
      handler: async (): Promise<ServiceIdentity[]> => {
        deps.authorize('data:read');
        await store.load();
        return store.listServices(deps.workspaceId());
      },
    },
    {
      /** Stop or restart a background service. Governance, not configuration. */
      channel: IpcChannel.IdentityServiceStatus,
      schema: IdentityServiceStatusRequest,
      requireAuth: true,
      audit: true,
      handler: async (p): Promise<ServiceIdentity | null> => {
        const req = p as IdentityServiceStatusRequestType;
        deps.authorize('governance:manage');
        await store.load();
        const service = store.serviceById(req.serviceId);
        if (!service || service.workspaceId !== deps.workspaceId()) return null;
        const updated = await store.setServiceStatus(req.serviceId, req.status);
        deps.audit({
          action: 'identity.service.status',
          target: req.serviceId,
          summary: `${deps.actor() ?? 'unknown'} set ${service.purpose} to ${req.status}.`,
        });
        return updated;
      },
    },
  ];

  log.info('Identity ready', { channels: handlers.length });
  /**
   * Read the file at composition, not on first use.
   *
   * Two things depend on it. `decidedAlready` is synchronous and would otherwise
   * answer "nobody decided" from an empty in-memory list, re-raising every
   * answered question once per restart. And a service authorizer's `allows` is
   * synchronous too — it reads the live row to honour a Stop, and an unloaded
   * store made the first check of every process miss a disabled service.
   */
  void store.load().catch((err: unknown) => {
    log.error('Identity state failed to load', { err: err instanceof Error ? err.message : String(err) });
  });

  return { handlers, store, serviceAuthorizer, decidedAlready };
}

/** The subject shape for a record, in one place so callers cannot disagree. */
export function recordSubject(moduleId: string, id: string, label: string): IdentitySubject {
  return { kind: 'record', scopeId: moduleId, id, label };
}
