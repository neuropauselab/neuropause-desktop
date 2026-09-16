import { describe, it, expect } from 'vitest';
import {
  parseDraft,
  draftMailViaGateway,
  servingDraftMailer,
  RawMailDraftSchema,
  type DraftAdapter,
} from './mailDraftGateway';
import { referenceDrafter } from '../../capabilities/assistantMailIntent';

const TURN = 'Email bob@example.com the quarterly numbers.';

describe('parseDraft (zod-enforced, fence-tolerant)', () => {
  it('accepts a valid JSON object, with or without code fences', () => {
    expect(parseDraft('{"subject":"Q3","body":"Here are the numbers."}')).toEqual({ subject: 'Q3', body: 'Here are the numbers.' });
    expect(parseDraft('```json\n{"subject":"Q3","body":"x"}\n```')).toEqual({ subject: 'Q3', body: 'x' });
    // Tolerates surrounding prose.
    expect(parseDraft('Sure! {"subject":"Q3","body":"x"} hope that helps')).toEqual({ subject: 'Q3', body: 'x' });
  });

  it('rejects malformed / out-of-limit / non-object output', () => {
    expect(parseDraft('not json at all')).toBeNull();
    expect(parseDraft('{"subject":"","body":"x"}')).toBeNull(); // empty subject
    expect(parseDraft(`{"subject":"${'x'.repeat(256)}","body":"y"}`)).toBeNull(); // subject > 255
    expect(parseDraft('{"body":"missing subject"}')).toBeNull();
    expect(RawMailDraftSchema.safeParse({ subject: 'x', body: 'y', purpose: 'z' }).success).toBe(true);
  });
});

describe('draftMailViaGateway (model → zod → one repair → honest fallback)', () => {
  it('valid on the first attempt → served by the model, 0 repairs', async () => {
    const adapter: DraftAdapter = async () => '{"subject":"Q3 numbers","body":"Attached."}';
    const out = await draftMailViaGateway(adapter, TURN, {});
    expect(out.servedBy).toBe('model');
    expect(out.repairs).toBe(0);
    expect(out.draft.subject).toBe('Q3 numbers');
  });

  it('invalid then valid → ONE repair retry serves the model (with the repair hint)', async () => {
    let seenHint: string | undefined;
    const adapter: DraftAdapter = async (_t, _c, hint) => {
      if (hint === undefined) return 'garbage, not json';
      seenHint = hint;
      return '{"subject":"Fixed","body":"Now valid."}';
    };
    const out = await draftMailViaGateway(adapter, TURN, {});
    expect(out.servedBy).toBe('model-repaired');
    expect(out.repairs).toBe(1);
    expect(seenHint).toMatch(/JSON object/i);
  });

  it('invalid twice → honest referenceDrafter fallback (NOT a model draft)', async () => {
    const adapter: DraftAdapter = async () => 'still not json';
    const out = await draftMailViaGateway(adapter, TURN, {});
    expect(out.servedBy).toBe('fallback');
    expect(out.repairs).toBe(1);
    expect(out.fallbackReason).toMatch(/schema-invalid/);
    // The fallback IS exactly what the deterministic drafter produces.
    expect(out.draft).toEqual(referenceDrafter(TURN, {}));
  });

  it('adapter throws → honest fallback, no repair attempted', async () => {
    const adapter: DraftAdapter = async () => {
      throw new Error('ollama unreachable');
    };
    const out = await draftMailViaGateway(adapter, TURN, {});
    expect(out.servedBy).toBe('fallback');
    expect(out.repairs).toBe(0);
    expect(out.fallbackReason).toMatch(/adapter error: ollama unreachable/);
    expect(out.draft).toEqual(referenceDrafter(TURN, {}));
  });
});

describe('servingDraftMailer (the LIVE draft lane, reference-only until eval clears)', () => {
  it('serves the deterministic referenceDrafter today (zero-model, permanent fallback)', () => {
    expect(servingDraftMailer()).toBe(referenceDrafter);
  });
});
