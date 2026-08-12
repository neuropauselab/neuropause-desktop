/**
 * P13C ROUND 13 — M-14. AN UNAUTHENTICATED LLM RUN OVER TENANT RECORDS.
 *
 * `ai:engineering-analyze` builds context from `unifiedStore`, `graphStore` and
 * `memoryStore` (with `memoryScope: activeTenantScope()`), runs it through
 * `aiEngine`, and returns `rootCause` / `engineeringRisk` / `recommendedAction`.
 * It was PUBLIC in both the central register and the AI family gate.
 *
 * IT SURVIVED ON THE WRONG AXIS. The family gate justified it as a
 * "non-persisting derivation" — true, and it answers MUTABILITY. The allowlist
 * rule is about the PAYLOAD, and its sibling `founder:ask-v2` had already been
 * moved off public for the identical reason ("answers are synthesised from this
 * tenant's records"). That sibling had two reasons to move; this one had the
 * first, which was always the sufficient one.
 *
 * AND THE TEST SUITE WAS HOLDING IT OPEN. `channelAuthorityTenancy` listed this
 * channel under "the reads that were public are still public" with the message
 * `must stay open`, so the earlier decision had been encoded as a REQUIREMENT.
 * That row is removed, with the reasoning, in that file.
 *
 * Second reason, independent of disclosure: an unauthenticated caller could
 * spend the install's configured model credential in a loop, shipping retrieved
 * tenant records to the configured destination, with no rate limit above
 * `runSecureHandler`.
 */
import { describe, expect, it } from 'vitest';
import { IpcChannel } from '@neuropause/shared';
import { AI_CHANNEL_AUTHORITY } from '../ai/aiAuthzGate';
import { PUBLIC_CHANNELS, RUNTIME_CHANNEL_PERMISSIONS } from '../ipc/runtimeAuthz';

describe('ai:engineering-analyze requires a session', () => {
  it('the AI family gate classifies it intelligence:read, not PUBLIC', () => {
    expect(AI_CHANNEL_AUTHORITY[IpcChannel.EngineeringAnalyze]).toBe('intelligence:read');
  });

  it('the central register agrees — one channel, one answer', () => {
    // NEW-M8's lesson: a channel classified in only ONE of the two tables can be
    // moved by a regression without either mechanism noticing.
    expect(RUNTIME_CHANNEL_PERMISSIONS[IpcChannel.EngineeringAnalyze]).toBe('intelligence:read');
  });

  it('it is off the public allowlist', () => {
    expect(PUBLIC_CHANNELS.has(IpcChannel.EngineeringAnalyze)).toBe(false);
  });

  it('it carries the SAME lock as founder:ask-v2, over the same corpus', () => {
    expect(AI_CHANNEL_AUTHORITY[IpcChannel.EngineeringAnalyze]).toBe(
      AI_CHANNEL_AUTHORITY[IpcChannel.FounderAskV2],
    );
  });

  it('founder:suggestions STAYS public — it is not the same shape', () => {
    // Fixed question templates plus coarse counts of the caller's own tenant.
    // The two were named together in the old comment and should not have been.
    expect(AI_CHANNEL_AUTHORITY[IpcChannel.FounderSuggestions]).toBe('PUBLIC');
    expect(PUBLIC_CHANNELS.has(IpcChannel.FounderSuggestions)).toBe(true);
  });
});
