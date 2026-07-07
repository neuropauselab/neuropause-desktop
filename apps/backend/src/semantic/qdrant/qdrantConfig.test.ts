import { describe, expect, it } from 'vitest';
import { loadQdrantConfig } from './qdrantConfig';
import { QdrantError } from './qdrantTypes';

describe('loadQdrantConfig', () => {
  it('defaults to local Qdrant, "memories", 768/Cosine', () => {
    const c = loadQdrantConfig({});
    expect(c.baseUrl).toBe('http://127.0.0.1:6333');
    expect(c.collection).toBe('memories');
    expect(c.dimensions).toBe(768);
    expect(c.distance).toBe('Cosine');
    expect(c.apiKey).toBeUndefined();
  });

  it('reads overrides and strips a trailing slash', () => {
    const c = loadQdrantConfig({ QDRANT_URL: 'https://q.example:6333/', QDRANT_COLLECTION: 'mem2', QDRANT_DIMENSIONS: '1536', QDRANT_API_KEY: 'k' });
    expect(c.baseUrl).toBe('https://q.example:6333');
    expect(c.collection).toBe('mem2');
    expect(c.dimensions).toBe(1536);
    expect(c.apiKey).toBe('k');
  });

  it('rejects an invalid distance and non-integer dimensions', () => {
    expect(() => loadQdrantConfig({ QDRANT_DISTANCE: 'Manhattan' })).toThrowError(QdrantError);
    expect(() => loadQdrantConfig({ QDRANT_DIMENSIONS: 'abc' })).toThrowError(/positive integer/);
  });
});
