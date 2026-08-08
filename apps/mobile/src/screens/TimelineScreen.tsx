/**
 * TimelineScreen (Mobile M1-11) — the enterprise Activity Timeline. Cursor-
 * paginated via timeline.list; entries are grouped by day (pure timelineModel)
 * and rendered in a SectionList with infinite scroll and pull-to-refresh. Uses
 * a SectionList as the root scroller (NOT the ScrollView-based <Screen>) so the
 * virtualized list is never nested inside a plain ScrollView.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CompanionTimelineEntry, CompanionTimelinePage } from '@neuropause/shared';
import { useCompanion } from '../state/CompanionProvider';
import { PrimaryButton } from '../components/ui';
import { groupByDay, mergeEntries, timeLabel } from '../state/timelineModel';
import { colors, font, space } from '../theme/tokens';

const PAGE = 30;

function TimelineRow({ entry }: { entry: CompanionTimelineEntry }): JSX.Element {
  const meta = [entry.category, entry.actorLabel, timeLabel(entry.at)].filter(Boolean).join(' · ');
  return (
    <View style={styles.row}>
      <View style={styles.dot} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {entry.title}
        </Text>
        {entry.summary ? (
          <Text style={styles.rowSummary} numberOfLines={2}>
            {entry.summary}
          </Text>
        ) : null}
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
    </View>
  );
}

export function TimelineScreen(): JSX.Element {
  const { rpc } = useCompanion();
  const [entries, setEntries] = useState<CompanionTimelineEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const moreRef = useRef(false);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await rpc<CompanionTimelinePage>('timeline.list', { limit: PAGE });
      setEntries(page.entries);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your timeline.');
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const page = await rpc<CompanionTimelinePage>('timeline.list', { limit: PAGE });
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setError(null);
    } catch {
      /* keep the current list on a failed refresh */
    } finally {
      setRefreshing(false);
    }
  }, [rpc]);

  const loadMore = useCallback(async () => {
    if (moreRef.current || !cursor) return;
    moreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await rpc<CompanionTimelinePage>('timeline.list', { cursor, limit: PAGE });
      setEntries((prev) => mergeEntries(prev, page.entries));
      setCursor(page.nextCursor);
    } catch {
      /* ignore; the user can pull to refresh */
    } finally {
      moreRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, rpc]);

  const sections = groupByDay(entries).map((d) => ({ title: d.label, data: d.entries }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {loading && entries.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && entries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <PrimaryButton label="Try again" onPress={() => void loadFirst()} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={<Text style={styles.h1}>Timeline</Text>}
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayHeader}>{section.title}</Text>
          )}
          renderItem={({ item }) => <TimelineRow entry={item} />}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.muted}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.accent} style={styles.footer} />
            ) : !cursor && entries.length > 0 ? (
              <Text style={styles.end}>That’s everything.</Text>
            ) : null
          }
          ListEmptyComponent={<Text style={styles.empty}>No activity yet.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xxl,
  },
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  h1: { color: colors.ink, fontSize: font.h1, fontWeight: '800', marginBottom: space.sm },
  dayHeader: {
    color: colors.muted,
    fontSize: font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 6 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: colors.ink, fontSize: font.body, fontWeight: '600' },
  rowSummary: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  rowMeta: { color: colors.faint, fontSize: font.tiny },
  footer: { marginVertical: space.lg },
  end: { color: colors.faint, fontSize: font.small, textAlign: 'center', marginVertical: space.lg },
  empty: { color: colors.muted, fontSize: font.body, textAlign: 'center', marginTop: space.xxl },
  error: { color: colors.danger, fontSize: font.body, textAlign: 'center' },
});
