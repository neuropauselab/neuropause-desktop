/**
 * A small, dependency-free Zod → JSON Schema (draft 2020-12 / OpenAPI 3.1) converter
 * (P3.0, Increment 2). It reads the Zod schema's internal `_def` to emit an equivalent
 * JSON Schema, so the OpenAPI document is GENERATED from the existing contract models
 * — never handwritten. It supports exactly the vocabulary the API contracts use
 * (object/string/number/boolean/enum/array/record/union/literal/null + optional/
 * nullable/default/effects wrappers) and falls back to a permissive `{}` for anything
 * else, so it can never throw on an unexpected node. Pinned to Zod 3.x internals.
 */
import type { ZodTypeAny } from 'zod';
import type { JsonSchema } from '@neuropause/shared';

interface ZodDefLike {
  typeName?: string;
  checks?: Array<{ kind: string; value?: unknown; regex?: RegExp }>;
  shape?: () => Record<string, ZodTypeAny>;
  unknownKeys?: string;
  type?: ZodTypeAny;
  innerType?: ZodTypeAny;
  schema?: ZodTypeAny;
  options?: ZodTypeAny[];
  values?: unknown;
  value?: unknown;
  valueType?: ZodTypeAny;
}

function def(schema: ZodTypeAny | undefined): ZodDefLike {
  if (!schema) return {};
  return (schema as unknown as { _def?: ZodDefLike })._def ?? {};
}

/** Peel optional/nullable/default/effects wrappers to reach the core type + flags. */
export function unwrap(schema: ZodTypeAny): { core: ZodTypeAny; optional: boolean; nullable: boolean } {
  let s = schema;
  let optional = false;
  let nullable = false;
  for (let i = 0; i < 20; i += 1) {
    const d = def(s);
    const tn = d.typeName;
    if (tn === 'ZodOptional' || tn === 'ZodDefault') {
      if (!d.innerType) break;
      optional = true;
      s = d.innerType;
    } else if (tn === 'ZodNullable') {
      if (!d.innerType) break;
      nullable = true;
      s = d.innerType;
    } else if (tn === 'ZodEffects') {
      if (!d.schema) break;
      s = d.schema;
    } else {
      break;
    }
  }
  return { core: s, optional, nullable };
}

function stringSchema(d: ZodDefLike): JsonSchema {
  const s: JsonSchema = { type: 'string' };
  for (const c of d.checks ?? []) {
    if (c.kind === 'min') s.minLength = c.value;
    else if (c.kind === 'max') s.maxLength = c.value;
    else if (c.kind === 'length') {
      s.minLength = c.value;
      s.maxLength = c.value;
    } else if (c.kind === 'email') s.format = 'email';
    else if (c.kind === 'url') s.format = 'uri';
    else if (c.kind === 'uuid') s.format = 'uuid';
    else if (c.kind === 'datetime') s.format = 'date-time';
    else if (c.kind === 'regex' && c.regex) s.pattern = c.regex.source;
  }
  return s;
}

function numberSchema(d: ZodDefLike): JsonSchema {
  const s: JsonSchema = { type: 'number' };
  for (const c of d.checks ?? []) {
    if (c.kind === 'int') s.type = 'integer';
    else if (c.kind === 'min') s.minimum = c.value;
    else if (c.kind === 'max') s.maximum = c.value;
  }
  return s;
}

function objectSchema(core: ZodTypeAny, depth: number): JsonSchema {
  const d = def(core);
  const shape = typeof d.shape === 'function' ? d.shape() : {};
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, val] of Object.entries(shape)) {
    properties[key] = zodToJsonSchema(val, depth + 1);
    if (!unwrap(val).optional) required.push(key);
  }
  const out: JsonSchema = { type: 'object', properties };
  if (required.length > 0) out.required = required;
  out.additionalProperties = d.unknownKeys === 'passthrough';
  return out;
}

/** Convert a Zod schema to a JSON Schema object. Pure; depth-guarded; never throws. */
export function zodToJsonSchema(schema: ZodTypeAny, depth = 0): JsonSchema {
  if (depth > 12) return {};
  const { core, nullable } = unwrap(schema);
  const d = def(core);
  let out: JsonSchema;
  switch (d.typeName) {
    case 'ZodString':
      out = stringSchema(d);
      break;
    case 'ZodNumber':
      out = numberSchema(d);
      break;
    case 'ZodBoolean':
      out = { type: 'boolean' };
      break;
    case 'ZodLiteral':
      out = { const: d.value };
      break;
    case 'ZodEnum':
      out = { type: 'string', enum: [...((d.values as unknown[]) ?? [])] };
      break;
    case 'ZodNativeEnum':
      out = { enum: Object.values((d.values as Record<string, unknown>) ?? {}) };
      break;
    case 'ZodArray':
      out = { type: 'array', items: d.type ? zodToJsonSchema(d.type, depth + 1) : {} };
      break;
    case 'ZodObject':
      out = objectSchema(core, depth);
      break;
    case 'ZodRecord':
      out = { type: 'object', additionalProperties: d.valueType ? zodToJsonSchema(d.valueType, depth + 1) : true };
      break;
    case 'ZodUnion':
      out = { anyOf: (d.options ?? []).map((o) => zodToJsonSchema(o, depth + 1)) };
      break;
    case 'ZodNull':
      out = { type: 'null' };
      break;
    default:
      out = {};
      break;
  }
  if (nullable) {
    if (typeof out.type === 'string') out = { ...out, type: [out.type, 'null'] };
    else out = { anyOf: [out, { type: 'null' }] };
  }
  return out;
}
