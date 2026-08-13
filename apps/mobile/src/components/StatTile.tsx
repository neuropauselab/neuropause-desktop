/**
 * StatTile (Mobile M1-09) — a big-number headline tile for Home. The value
 * dominates; an emphasised tile (e.g. approvals waiting) picks up its band
 * colour on the border and the underline accent.
 */
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme/tokens';
import type { HomeTile } from '../state/homeModel';

export function StatTile({ tile }: { tile: HomeTile }): JSX.Element {
  const tone = colors.bands[tile.band];
  return (
    <View style={[styles.tile, tile.emphasis && { borderColor: tone }]}>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {tile.value}
      </Text>
      <Text style={styles.label} numberOfLines={2}>
        {tile.label}
      </Text>
      <View style={[styles.accent, { backgroundColor: tone }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.md,
    minHeight: 96,
    justifyContent: 'flex-start',
  },
  value: { color: colors.ink, fontSize: font.h1, fontWeight: '700' },
  label: { color: colors.muted, fontSize: font.tiny, marginTop: space.xs },
  accent: { height: 3, borderRadius: 2, marginTop: space.sm, width: 28 },
});
