/**
 * HomeScreen (Mobile M1-09, +M1-13 Settings). The executive landing tab: the
 * desktop's composed briefing (briefing.get) rendered 80%-visual — greeting +
 * headline, three headline stat tiles, the "waiting on you" urgent-approvals
 * list, and the busiest families. A gear in the top bar opens the Settings sheet.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { CompanionBriefing } from '@neuropause/shared';
import { useCompanion } from '../state/CompanionProvider';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { StatTile } from '../components/StatTile';
import { RankBars } from '../components/charts/RankBars';
import { SettingsIcon } from '../components/icons';
import { SettingsSheet } from './SettingsSheet';
import { familyBars } from '../state/dashboardModel';
import { greeting, homeTiles } from '../state/homeModel';
import { colors, font, space } from '../theme/tokens';

export function HomeScreen(): JSX.Element {
  const { rpc, session } = useCompanion();
  const [briefing, setBriefing] = useState<CompanionBriefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBriefing(await rpc<CompanionBriefing>('briefing.get'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your briefing.');
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  let body: JSX.Element;
  if (loading && !briefing) {
    body = (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (error && !briefing) {
    body = (
      <Card title="Couldn’t reach your desktop">
        <Text style={styles.error}>{error}</Text>
        <Text style={styles.hint}>
          Pull down to retry. Make sure your desktop is on the same network with the companion
          gateway running.
        </Text>
      </Card>
    );
  } else if (briefing) {
    const tiles = homeTiles(briefing);
    body = (
      <>
        <View style={styles.header}>
          <Text style={styles.greeting}>
            {greeting(briefing.period)}
            {session?.orgName ? ` · ${session.orgName}` : ''}
          </Text>
          <Text style={styles.headline}>{briefing.headline}</Text>
        </View>

        <View style={styles.tiles}>
          {tiles.map((t) => (
            <StatTile key={t.key} tile={t} />
          ))}
        </View>

        <Card title="Waiting on you">
          {briefing.urgentApprovals.length === 0 ? (
            <Text style={styles.calm}>You’re all caught up.</Text>
          ) : (
            <View style={styles.urgentList}>
              {briefing.urgentApprovals.map((u, i) => (
                <View key={`${u.moduleTitle}-${i}`} style={styles.urgentRow}>
                  <View style={styles.urgentDot} />
                  <View style={styles.urgentText}>
                    <Text style={styles.urgentTitle} numberOfLines={1}>
                      {u.title}
                    </Text>
                    <Text style={styles.urgentModule} numberOfLines={1}>
                      {u.moduleTitle}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        {briefing.families.length > 0 ? (
          <Card title="Busiest families">
            <RankBars data={familyBars(briefing.families, 6)} />
          </Card>
        ) : null}
      </>
    );
  } else {
    body = <View />;
  }

  return (
    <>
      <Screen onRefresh={load} refreshing={loading}>
        <View style={styles.topBar}>
          <Text style={styles.brand}>NeuroPause</Text>
          <Pressable
            onPress={() => setSettingsOpen(true)}
            hitSlop={10}
            accessibilityLabel="Settings"
          >
            <SettingsIcon color={colors.muted} size={22} />
          </Pressable>
        </View>
        {body}
      </Screen>
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.faint, fontSize: font.small, fontWeight: '700', letterSpacing: 0.4 },
  loading: { paddingVertical: space.xxl * 2, alignItems: 'center' },
  header: { gap: space.xs },
  greeting: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  headline: { color: colors.ink, fontSize: font.h1, fontWeight: '800', lineHeight: 34 },
  tiles: { flexDirection: 'row', gap: space.md },
  calm: { color: colors.muted, fontSize: font.body },
  urgentList: { gap: space.md },
  urgentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  urgentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.bands.watch },
  urgentText: { flex: 1 },
  urgentTitle: { color: colors.ink, fontSize: font.body, fontWeight: '600' },
  urgentModule: { color: colors.faint, fontSize: font.small },
  error: { color: colors.danger, fontSize: font.body },
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
});
