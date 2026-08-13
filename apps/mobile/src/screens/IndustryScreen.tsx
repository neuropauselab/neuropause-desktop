/**
 * IndustryScreen (IP-11) — the executive Industry tab. Shows the desktop's
 * canonical Wave 9 catalog (industry.snapshot): honest capability readiness, the
 * vertical solution packs ranked by declared capability, and the capability
 * evidence areas. Read-only, and the SAME snapshot DTO the desktop Industry
 * Center renders — no new industry logic or per-tenant data on the phone.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { IndustryCatalogSnapshot } from '@neuropause/shared';
import { useCompanion } from '../state/CompanionProvider';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { RankBars } from '../components/charts/RankBars';
import { areaBars, evidenceColor, packBars } from '../state/industryModel';
import { colors, font, radius, space } from '../theme/tokens';

export function IndustryScreen(): JSX.Element {
  const { rpc } = useCompanion();
  const [snapshot, setSnapshot] = useState<IndustryCatalogSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await rpc<IndustryCatalogSnapshot>('industry.snapshot'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the industry catalog.');
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <Card title="Couldn’t load Industry">
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.hint}>Pull down to retry.</Text>
        </Card>
      </Screen>
    );
  }

  if (!snapshot) {
    return (
      <Screen onRefresh={load} refreshing={loading}>
        <Card title="Industry">
          <Text style={styles.hint}>No industry catalog available.</Text>
        </Card>
      </Screen>
    );
  }

  const r = snapshot.readiness;
  const readiness = [
    { label: 'Live-verified', value: r.liveVerified, level: 'live-verified' },
    { label: 'Adapter-verified', value: r.adapterVerified, level: 'adapter-verified' },
    { label: 'Data pending', value: r.businessDataPending, level: 'business-data-pending' },
    { label: 'External', value: r.regulatedExternal, level: 'regulated-external' },
  ];

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <Text style={styles.h1}>Industry</Text>
      <Text style={styles.subtitle}>
        {snapshot.industries.length} solution packs · {r.liveVerifiedPct}% live-verified · v
        {snapshot.version}
      </Text>

      <Card title="Capability readiness">
        <View style={styles.readinessGrid}>
          {readiness.map((cell) => (
            <View key={cell.level} style={styles.readinessCell}>
              <View style={styles.readinessHead}>
                <View style={[styles.dot, { backgroundColor: evidenceColor(cell.level) }]} />
                <Text style={styles.readinessValue}>{cell.value}</Text>
              </View>
              <Text style={styles.readinessLabel} numberOfLines={1}>
                {cell.label}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.hint}>
          {r.liveVerified} of {r.total} platform capabilities are live-verified today; the rest are
          adapter-verified, data-pending, or externally attested.
        </Text>
      </Card>

      <Card title="Solution packs">
        {snapshot.industries.length === 0 ? (
          <Text style={styles.hint}>No solution packs in the catalog.</Text>
        ) : (
          <RankBars data={packBars(snapshot)} />
        )}
        <Text style={styles.tapHint}>
          Ranked by declared capabilities · each reuses core domains
        </Text>
      </Card>

      <Card title="Capability areas">
        {snapshot.capabilities.length === 0 ? (
          <Text style={styles.hint}>No capability evidence in the catalog.</Text>
        ) : (
          <RankBars data={areaBars(snapshot)} color={colors.categorical[2]} />
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: space.xxl * 2, alignItems: 'center' },
  h1: { color: colors.ink, fontSize: font.h1, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: font.small, marginTop: 2 },
  readinessGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  readinessCell: {
    minWidth: 96,
    flexGrow: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: space.md,
  },
  readinessHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  readinessValue: { color: colors.ink, fontSize: font.h2, fontWeight: '700' },
  readinessLabel: { color: colors.muted, fontSize: font.tiny, marginTop: 2 },
  tapHint: { color: colors.faint, fontSize: font.tiny, marginTop: space.xs },
  error: { color: colors.danger, fontSize: font.body },
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 20, marginTop: space.xs },
});
