import { describe, expect, it } from "vitest";
import type { MemoryItem, MemoryMeta } from "@neuropause/shared";
import {
  LEXICAL_RANKING_WEIGHTS,
  memoryCandidateMetadata,
  rankRecallHits,
} from "./memoryRecallRanking";
import type { RetrievalHit } from "./memoryHybridSearch";

const NOW = "2024-01-31T00:00:00.000Z";
const DAY = 86_400_000;

function iso(msAgo: number): string {
  return new Date(Date.parse(NOW) - msAgo).toISOString();
}

function makeItem(over: Partial<MemoryItem> & { id: string }): MemoryItem {
  return {
    kind: "note",
    origin: "explicit",
    title: over.id,
    content: "content",
    connectorId: null,
    source: "manual",
    entityRefs: [],
    tags: [],
    occurredAt: null,
    createdAt: iso(30 * DAY),
    updatedAt: iso(30 * DAY),
    evidence: null,
    metadata: {},
    ...over,
  };
}

/** Build a getItem over a fixed item set, honoring an optional filter predicate. */
function itemLookup(
  items: MemoryItem[],
  filter: (it: MemoryItem) => boolean = () => true,
): (id: string) => MemoryItem | undefined {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (id) => {
    const it = byId.get(id);
    return it && filter(it) ? it : undefined;
  };
}

const hits = (...ids: string[]): RetrievalHit[] =>
  ids.map((id, i) => ({ memoryId: id, score: 1 - i * 0.001 })); // near-equal lexical scores

// ---------------------------------------------------------------------------
// memoryCandidateMetadata
// ---------------------------------------------------------------------------

describe("memoryCandidateMetadata", () => {
  it("marks a synced item as organization scope with org + deleted from sync", () => {
    const item = makeItem({
      id: "a",
      sync: {
        orgId: "org_1",
        versionId: "v1",
        parentVersion: null,
        history: [{ versionId: "v1", timestamp: NOW, deleted: false }],
        deleted: false,
      },
    });
    const meta = memoryCandidateMetadata(item);
    expect(meta.scope).toBe("organization");
    expect(meta.orgId).toBe("org_1");
    expect(meta.deleted).toBe(false);
  });

  it("marks an unsynced item as personal with no org and not deleted", () => {
    const meta = memoryCandidateMetadata(makeItem({ id: "a" }));
    expect(meta.scope).toBe("personal");
    expect(meta.orgId).toBeUndefined();
    expect(meta.deleted).toBe(false);
  });

  it("reports a synced tombstone as deleted", () => {
    const item = makeItem({
      id: "a",
      sync: {
        orgId: "org_1",
        versionId: "v2",
        parentVersion: "v1",
        history: [{ versionId: "v2", timestamp: NOW, deleted: true }],
        deleted: true,
      },
    });
    expect(memoryCandidateMetadata(item).deleted).toBe(true);
  });

  it("pulls importance / pinned / project from metadata when present", () => {
    const metadata: MemoryMeta = {
      importance: 0.8,
      pinned: true,
      project: "Atlas",
    };
    const meta = memoryCandidateMetadata(makeItem({ id: "a", metadata }));
    expect(meta.importance).toBe(0.8);
    expect(meta.pinned).toBe(true);
    expect(meta.project).toBe("Atlas");
  });

  it("omits importance / project and defaults pinned=false when metadata lacks them", () => {
    const meta = memoryCandidateMetadata(
      makeItem({ id: "a", metadata: { note: "x" } }),
    );
    expect(meta.importance).toBeUndefined();
    expect(meta.project).toBeUndefined();
    expect(meta.pinned).toBe(false);
  });

  it("uses occurredAt, then updatedAt, then createdAt as the recency anchor", () => {
    expect(
      memoryCandidateMetadata(
        makeItem({
          id: "a",
          occurredAt: iso(0),
          updatedAt: iso(DAY),
          createdAt: iso(2 * DAY),
        }),
      ).timestamp,
    ).toBe(iso(0));
    expect(
      memoryCandidateMetadata(
        makeItem({
          id: "a",
          occurredAt: null,
          updatedAt: iso(DAY),
          createdAt: iso(2 * DAY),
        }),
      ).timestamp,
    ).toBe(iso(DAY));
  });

  it("exposes a lexical-only weight profile that zeroes vector", () => {
    expect(LEXICAL_RANKING_WEIGHTS.vector).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rankRecallHits — integration over the real ranking pipeline
// ---------------------------------------------------------------------------

describe("rankRecallHits", () => {
  it("returns an empty array for no lexical hits", () => {
    expect(
      rankRecallHits({
        query: {},
        lexicalHits: [],
        getItem: () => undefined,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("normalizes the 0..100 rank score back into the 0..1 recall contract", () => {
    const items = [makeItem({ id: "a", occurredAt: iso(0) })];
    const [hit] = rankRecallHits({
      query: {},
      lexicalHits: hits("a"),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(hit.score).toBeGreaterThan(0);
    expect(hit.score).toBeLessThanOrEqual(1);
  });

  it("ranks the more recent of two equally-keyworded memories higher (recency boost)", () => {
    const items = [
      makeItem({ id: "old", occurredAt: iso(60 * DAY) }),
      makeItem({ id: "new", occurredAt: iso(0) }),
    ];
    const ranked = rankRecallHits({
      query: {},
      lexicalHits: hits("old", "new"),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(ranked.map((h) => h.item.id)).toEqual(["new", "old"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("floats a pinned memory above an equally-keyworded, equally-recent one", () => {
    const items = [
      makeItem({ id: "plain", occurredAt: iso(0) }),
      makeItem({
        id: "pinned",
        occurredAt: iso(0),
        metadata: { pinned: true },
      }),
    ];
    const ranked = rankRecallHits({
      query: {},
      lexicalHits: hits("plain", "pinned"),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(ranked[0].item.id).toBe("pinned");
  });

  it("ranks higher authored importance above lower when other signals match", () => {
    const items = [
      makeItem({
        id: "low",
        occurredAt: iso(0),
        metadata: { importance: 0.1 },
      }),
      makeItem({
        id: "high",
        occurredAt: iso(0),
        metadata: { importance: 0.9 },
      }),
    ];
    const ranked = rankRecallHits({
      query: {},
      lexicalHits: hits("low", "high"),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(ranked[0].item.id).toBe("high");
  });

  it("drops hits the caller excludes via getItem (filter passthrough)", () => {
    const items = [
      makeItem({ id: "keep", kind: "note", occurredAt: iso(0) }),
      makeItem({ id: "drop", kind: "task", occurredAt: iso(0) }),
    ];
    // Simulate recall's kind filter: only 'note' survives.
    const ranked = rankRecallHits({
      query: {},
      lexicalHits: hits("keep", "drop"),
      getItem: itemLookup(items, (it) => it.kind === "note"),
      now: NOW,
    });
    expect(ranked.map((h) => h.item.id)).toEqual(["keep"]);
  });

  it("excludes a synced tombstone even if it slips through as a hit", () => {
    const items = [
      makeItem({ id: "live", occurredAt: iso(0) }),
      makeItem({
        id: "dead",
        occurredAt: iso(0),
        sync: {
          orgId: "o",
          versionId: "v2",
          parentVersion: "v1",
          history: [{ versionId: "v2", timestamp: NOW, deleted: true }],
          deleted: true,
        },
      }),
    ];
    const ranked = rankRecallHits({
      query: {},
      lexicalHits: hits("live", "dead"),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(ranked.map((h) => h.item.id)).toEqual(["live"]);
  });

  it("respects the query limit", () => {
    const items = ["a", "b", "c", "d"].map((id) =>
      makeItem({ id, occurredAt: iso(0) }),
    );
    const ranked = rankRecallHits({
      query: { limit: 2 },
      lexicalHits: hits("a", "b", "c", "d"),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(ranked).toHaveLength(2);
  });

  it("is deterministic and independent of hit order", () => {
    const items = [
      makeItem({ id: "a", occurredAt: iso(3 * DAY) }),
      makeItem({ id: "b", occurredAt: iso(1 * DAY) }),
      makeItem({ id: "c", occurredAt: iso(10 * DAY) }),
    ];
    const forward = rankRecallHits({
      query: {},
      lexicalHits: hits("a", "b", "c"),
      getItem: itemLookup(items),
      now: NOW,
    });
    const reversed = rankRecallHits({
      query: {},
      lexicalHits: [...hits("a", "b", "c")].reverse(),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(reversed.map((h) => h.item.id)).toEqual(
      forward.map((h) => h.item.id),
    );
    expect(reversed.map((h) => h.score)).toEqual(forward.map((h) => h.score));
  });

  it("preserves the full MemoryItem on each returned hit", () => {
    const items = [
      makeItem({ id: "a", title: "Investor Deck", occurredAt: iso(0) }),
    ];
    const [hit] = rankRecallHits({
      query: {},
      lexicalHits: hits("a"),
      getItem: itemLookup(items),
      now: NOW,
    });
    expect(hit.item.title).toBe("Investor Deck");
    expect(hit.item.kind).toBe("note");
  });
});
