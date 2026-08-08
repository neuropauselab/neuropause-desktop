/**
 * SettingsSheet (Mobile M1-13) — a bottom-sheet Modal (opened from the Home
 * header) showing the paired session, app/protocol versions, the security model,
 * and Sign out / Unpair. No new tab or routing change; it overlays the tabs.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCompanion } from '../state/CompanionProvider';
import { PrimaryButton } from '../components/ui';
import { settingsRows, type SessionHello } from '../state/settingsModel';
import { colors, font, radius, space } from '../theme/tokens';

const APP_VERSION = '0.1.0';
const SECURITY_NOTE =
  'Every request is an end-to-end sealed envelope. Your desktop’s key was pinned when you scanned the pairing code, and this device’s identity key lives in the secure keychain. Face ID guards the app on launch.';

export function SettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): JSX.Element {
  const { session, rpc, signOut } = useCompanion();
  const [hello, setHello] = useState<SessionHello | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    rpc<SessionHello>('session.hello')
      .then((h) => {
        if (live) setHello(h);
      })
      .catch(() => {
        /* fall back to the pinned session values */
      });
    return () => {
      live = false;
    };
  }, [visible, rpc]);

  const rows = session ? settingsRows(session, hello, APP_VERSION) : [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Settings</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              {rows.map((r, i) => (
                <View key={r.label} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <Text style={styles.rowLabel}>{r.label}</Text>
                  <Text style={styles.rowValue} numberOfLines={1}>
                    {r.value}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Security</Text>
            <Text style={styles.note}>{SECURITY_NOTE}</Text>

            <View style={styles.signOut}>
              <PrimaryButton
                label="Sign out / Unpair"
                variant="ghost"
                onPress={() => {
                  onClose();
                  void signOut();
                }}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingBottom: space.xxl,
    maxHeight: '86%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    marginTop: space.sm,
    marginBottom: space.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  title: { color: colors.ink, fontSize: font.h2, fontWeight: '700' },
  done: { color: colors.accent, fontSize: font.body, fontWeight: '600' },
  content: { gap: space.md, paddingBottom: space.lg },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowLabel: { color: colors.muted, fontSize: font.small },
  rowValue: { color: colors.ink, fontSize: font.small, flexShrink: 1, textAlign: 'right' },
  sectionLabel: {
    color: colors.muted,
    fontSize: font.small,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.sm,
  },
  note: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
  signOut: { marginTop: space.md },
});
