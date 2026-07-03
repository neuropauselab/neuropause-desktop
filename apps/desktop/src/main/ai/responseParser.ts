/**
 * Response Parser. Turns raw model text into a structured payload. When the
 * prompt asked for JSON, it parses it (tolerating ```json fences and prose around
 * the object); otherwise it returns the text with a null payload. It also pulls a
 * 0..1 confidence and any evidence refs the model echoed back.
 */
import type { AiEvidence } from '@neuropause/shared';

export interface ParsedResponse {
  text: string;
  data: Record<string, unknown> | null;
  confidence: number;
  evidence: AiEvidence[];
}

const DEFAULT_CONFIDENCE = 0.5;

export function parseModelText(raw: string): ParsedResponse {
  const text = raw.trim();
  const data = tryParseJson(text);
  let confidence = DEFAULT_CONFIDENCE;
  let evidence: AiEvidence[] = [];
  if (data) {
    const c = data['confidence'];
    if (typeof c === 'number' && c >= 0 && c <= 1) confidence = c;
    evidence = readEvidence(data['evidence']);
  }
  return { text, data, confidence, evidence };
}

/** Parse a JSON object from text, tolerating code fences and surrounding prose. */
function tryParseJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || sliceObject(text);
  if (!candidate) return null;
  try {
    const v = JSON.parse(candidate) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Extract the outermost {...} block if the whole string isn't already JSON. */
function sliceObject(text: string): string | null {
  if (text.startsWith('{') && text.endsWith('}')) return text;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

function readEvidence(v: unknown): AiEvidence[] {
  if (!Array.isArray(v)) return [];
  const out: AiEvidence[] = [];
  for (const e of v) {
    if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).id === 'string') {
      const rec = e as Record<string, unknown>;
      out.push({ kind: typeof rec.kind === 'string' ? rec.kind : 'unknown', id: rec.id as string });
    }
  }
  return out;
}
