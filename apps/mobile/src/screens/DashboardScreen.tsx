/**
 * DashboardScreen (Mobile M1-09) — the enterprise dashboard tab. Shows the
 * desktop's real executive KPI strip (dashboard.snapshot) and the families the
 * user can drill into (dashboard.families). Tapping a family loads its full
 * dashboard (dashboard.family — the SAME shared model the desktop renders) and
 * shows its KPIs, per-module activity, status mix, and 6-month trend.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  CompanionDashboardSnapshot,
  CompanionFamilySummary,
  FamilyDashboardData,
} from '@neuropause/shared';
import { useCompanion } from '../state/CompanionProvider';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { KpiTile } from '../components/KpiTile';
import { RankBars } from '../components/charts/RankBars';
import { TrendBars } from '../components/charts/TrendBars';
import { Donut } from '../components/charts/Donut';
import { familyBars, moduleBars, statusDonutSlices, trendBars } from '../state/dashboardModel';
import { colors, font, radius, space } from '../theme/tokens';

export function DashboardScreen(): JSX.Element {
  const { rpc } = useCompanion();
  const [snapshot, setSnapshot] = useState<CompanionDashboardSnapshot | null>(null);
  const [families, setFamilies] = useState<CompanionFamilySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<FamilyDashboardData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snap, fam] = await Promise.all([
        rpc<CompanionDashboardSnapshot>('dashboard.snapshot'),
        rpc<CompanionFamilySummary[]>('dashboard.families'),
      ]);
      setSnapshot(snap);
      setFamilies(fam);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your dashboard.');
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFamily = useCallback(
    async (group: string) => {
      setSelected(group);
      setDetail(null);
      setDetailLoading(true);
      try {
        setDetail(await rpc<FamilyDashboardData>('dashboard.family', { group }));
      } catch {
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [rpc],
  );

  if (loading && !snapshot) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (error && !snapshot) {
    return (
      <Screen onRefresh={load} refreshing={loading}>
        <Card title="Couldn’t load the dashboard">
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.hint}>Pull down to retry.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <Text style={styles.h1}>Dashboard</Text>

      {snapshot && snapshot.kpis.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {snapshot.kpis.map((k) => (
            <KpiTile key={k.key} kpi={k} />
          ))}
        </ScrollView>
      ) : null}

      <Card title="Families">
        {families.length === 0 ? (
          <Text style={styles.hint}>No enterprise families yet.</Text>
        ) : (
          <RankBars data={familyBars(families)} onSelect={(d) => void openFamily(d.label)} />
        )}
        <Text style={styles.tapHint}>Tap a family to drill in</Text>
      </Card>

      {selected ? (
        <Card>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle} numberOfLines={1}>
              {selected}
            </Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={10}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>

          {detailLoading ? (
            <View style={styles.detailLoading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : !detail ? (
            <Text style={styles.hint}>No live records in this family yet.</Text>
          ) : (
            <View style={styles.detailBody}>
              {detail.kpis.length > 0 ? (
                <View style={styles.kpiGrid}>
                  {detail.kpis.map((k, i) => (
                    <View key={`${k.label}-${i}`} style={styles.kpiCell}>
                      <Text style={styles.kpiValue} numberOfLines={1}>
                        {k.value}
                      </Text>
                      <Text style={styles.kpiLabel} numberOfLines={1}>
                        {k.label}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {detail.moduleBars.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Active records by module</Text>
                  <RankBars data={moduleBars(detail)} color={colors.categorical[2]} />
                </View>
              ) : null}

              {detail.statusDonut ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>{detail.statusDonut.title}</Text>
                  <Donut slices={statusDonutSlices(detail)} />
                </View>
              ) : null}

              {detail.creationTrend.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>New records · last 6 months</Text>
                  <TrendBars data={trendBars(detail)} color={colors.categorical[6]} />
                </View>
              ) : null}
            </View>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: space.xxl * 2, alignItems: 'center' },
  h1: { color: colors.ink, fontSize: font.h1, fontWeight: '800' },
  strip: { gap: space.md, paddingVertical: space.xs },
  tapHint: { color: colors.faint, fontSize: font.tiny, marginTop: space.xs },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailTitle: { color: colors.ink, fontSize: font.h2, fontWeight: '700', flex: 1 },
  close: { color: colors.accent, fontSize: font.small, fontWeight: '600' },
  detailLoading: { paddingVertical: space.xl, alignItems: 'center' },
  detailBody: { gap: space.lg },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kpiCell: {
    minWidth: 96,
    flexGrow: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: space.md,
  },
  kpiValue: { color: colors.ink, fontSize: font.h2, fontWeight: '700' },
  kpiLabel: { color: colors.muted, fontSize: font.tiny, marginTop: 2 },
  section: { gap: space.sm },
  sectionLabel: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  error: { color: colors.danger, fontSize: font.body },
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
});
