/**
 * @neuropause/ckdl — the Constitutional Knowledge & Decision Layer (NCEA 11.1).
 *
 * The governed semantic foundation built ON the Enterprise Runtime. One knowledge
 * graph over every enterprise entity (as governed references, never copies), a
 * decision graph where every decision is evidence-bound and replayable, an
 * evidence engine that carries provenance, an explainable trust model that never
 * fabricates certainty, first-class objectives, and decision intelligence whose
 * every output cites its evidence. Mission Control consumes this layer; the
 * runtime hosts it. Nothing bypasses governance; no knowledge is duplicated.
 *
 * STATUS: PREVIEW foundation. Pure, in-memory. Similarity is a deterministic
 * keyword heuristic; real semantic/vector search, embeddings, and distributed
 * graph storage require external infrastructure and are NOT included here.
 */
export * from './constants';
export * from './util';
export * from './governance';
export * from './entities';
export * from './relationships';
export * from './graph';
export * from './evidence';
export * from './trust';
export * from './decisions';
export * from './objectives';
export * from './analysis';
export * from './search';
export * from './platform';
