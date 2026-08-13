/**
 * NotificationsScreen (Mobile M1-12) — the Notification Center. Loads the inbox
 * (notifications.list) and subscribes to the live sealed WS: when the desktop
 * pushes an event, the list refetches silently so the phone stays current
 * without a manual pull. Priority drives the accent colour; unread rows are
 * emphasised.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { CompanionNotificationsPage } from '@neuropause/shared';
import { useCompanion } from '../state/CompanionProvider';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { priorityColor, unreadCount } from '../state/notificationsModel';
import { dayKey, dayLabel, timeLabel } from '../state/timelineModel';
import { colors, font, radius, space } from '../theme/tokens';

export function NotificationsScreen(): JSX.Element {
  const { rpc, subscribeEvents } = useCompanion();
  const [page, setPage] = useState<CompanionNotificationsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        setPage(await rpc<CompanionNotificationsPage>('notifications.list', { limit: 50 }));
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : 'Could not load notifications.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [rpc],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live: refetch quietly whenever the desktop pushes an event.
  useEffect(() => subscribeEvents(() => void load(true)), [subscribeEvents, load]);

  if (loading && !page) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (error && !page) {
    return (
      <Screen onRefresh={() => void load()} refreshing={loading}>
        <Card title="Couldn’t load notifications">
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.hint}>Pull down to retry.</Text>
        </Card>
      </Screen>
    );
  }

  const items = page?.items ?? [];
  const unread = page ? page.unread : unreadCount(items);

  return (
    <Screen onRefresh={() => void load()} refreshing={loading}>
      <View style={styles.header}>
        <Text style={styles.h1}>Notifications</Text>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread} new</Text>
          </View>
        ) : null}
      </View>

      {items.length === 0 ? (
        <Card>
          <Text style={styles.calm}>No notifications.</Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {items.map((n) => {
            const tone = priorityColor(n.priority);
            const when = `${dayLabel(dayKey(n.at))} · ${timeLabel(n.at)}`.replace(/ · $/, '');
            return (
              <View key={n.id} style={[styles.row, !n.read && styles.rowUnread]}>
                <View style={[styles.dot, { backgroundColor: tone }]} />
                <View style={styles.body}>
                  <Text style={[styles.title, !n.read && styles.titleUnread]} numberOfLines={2}>
                    {n.title}
                  </Text>
                  {n.body ? (
                    <Text style={styles.text} numberOfLines={3}>
                      {n.body}
                    </Text>
                  ) : null}
                  <Text style={styles.meta}>{when}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: space.xxl * 2, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { color: colors.ink, fontSize: font.h1, fontWeight: '800' },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 3,
  },
  badgeText: { color: '#fff', fontSize: font.tiny, fontWeight: '700' },
  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.md,
  },
  rowUnread: { backgroundColor: colors.surfaceRaised, borderColor: 'rgba(57,135,229,0.4)' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  body: { flex: 1, gap: 3 },
  title: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
  titleUnread: { color: colors.ink },
  text: { color: colors.muted, fontSize: font.small, lineHeight: 19 },
  meta: { color: colors.faint, fontSize: font.tiny },
  calm: { color: colors.muted, fontSize: font.body },
  error: { color: colors.danger, fontSize: font.body },
  hint: { color: colors.muted, fontSize: font.small },
});
