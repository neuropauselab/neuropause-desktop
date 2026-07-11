/**
 * Minimal OpenAPI 3.1 document shapes (P3.0, Increment 2).
 *
 * Just enough of the spec to type the generated document the platform emits. The
 * document is GENERATED at runtime from the route table + the existing Zod contract
 * schemas (see `main/api/openapi.ts`) — never handwritten — so it stays in sync with
 * the API automatically. `JsonSchema` is left open (a record) because it is produced
 * by the Zod→JSON-Schema converter, not authored by hand.
 */

export type JsonSchema = Record<string, unknown>;

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema: JsonSchema;
}

export interface OpenApiMediaType {
  schema: JsonSchema;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  tags: string[];
  security: Array<Record<string, string[]>>;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string; description?: string };
  servers: Array<{ url: string; description?: string }>;
  tags: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes: Record<string, JsonSchema>;
    schemas: Record<string, JsonSchema>;
  };
  security: Array<Record<string, string[]>>;
}
