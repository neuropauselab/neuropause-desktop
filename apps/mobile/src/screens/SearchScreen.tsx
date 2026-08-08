/**
 * SearchScreen (Mobile M1-11) — enterprise search over the sealed channel.
 * Debounced query → rpc('search.query',{text}) → hits grouped by source. The
 * scope boundary is stated in-UI: this searches connectors / UDM / knowledge
 * graph / memory / timeline, NOT raw ERP record bodies (a record surfaces by
 * title only once it appears on the timeline).
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CompanionSearchResult } from '@neuropause/shared';
import { useCompanion } from '../state/CompanionProvider';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { groupBySource } from '../state/searchModel';
import { dayKey, dayLabel } from '../state/timelineModel';
import { colors, font, radius, space } from '../theme/tokens';

export function SearchScreen(): JSX.Element {
  const { rpc } = useCompanion();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<CompanionSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      rpc<CompanionSearchResult>('search.query', { text })
        .then((r) => {
          if (reqId.current === id) {
            setResult(r);
            setLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (reqId.current === id) {
            setError(err instanceof Error ? err.message : 'Search failed.');
            setLoading(false);
          }
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, rpc]);

  const groups = result ? groupBySource(result.hits) : [];
  const showEmpty = result !== null && !loading && result.total === 0;

  return (
    <Screen>
      <Text style={styles.h1}>Search</Text>
      <TextInput
        style={styles.input}
        placeholder="Search connectors, memory, timeline…"
        placeholderTextColor={colors.faint}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      <Text style={styles.boundary}>
        Searches your connectors, knowledge graph, memory and timeline — not raw ERP record bodies.
      </Text>

      {loading ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}

      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
        </Card>
      ) : null}

      {showEmpty ? <Text style={styles.empty}>No matches for “{query.trim()}”.</Text> : null}

      {groups.map((group) => (
        <Card key={group.source} title={`${group.source} · ${group.hits.length}`}>
          <View style={styles.hits}>
            {group.hits.map((h) => {
              const when = h.timestamp ? dayLabel(dayKey(h.timestamp)) : '';
              const meta = [h.kind, when].filter(Boolean).join(' · ');
              return (
                <View key={h.id} style={styles.hit}>
                  <Text style={styles.hitTitle} numberOfLines={2}>
                    {h.title}
                  </Text>
                  {h.snippet ? (
                    <Text style={styles.hitSnippet} numberOfLines={2}>
                      {h.snippet}
                    </Text>
                  ) : null}
                  {meta ? <Text style={styles.hitMeta}>{meta}</Text> : null}
                </View>
              );
            })}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.ink, fontSize: font.h1, fontWeight: '800' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    color: colors.ink,
    fontSize: font.body,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  boundary: { color: colors.faint, fontSize: font.tiny, lineHeight: 16 },
  spinner: { marginTop: space.sm },
  hits: { gap: space.md },
  hit: { gap: 2 },
  hitTitle: { color: colors.ink, fontSize: font.body, fontWeight: '600' },
  hitSnippet: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  hitMeta: { color: colors.faint, fontSize: font.tiny },
  empty: { color: colors.muted, fontSize: font.body },
  error: { color: colors.danger, fontSize: font.body },
});
