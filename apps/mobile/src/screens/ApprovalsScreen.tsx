/**
 * ApprovalsScreen (Mobile M1-10) — the Approval Center. Pulls the cross-module
 * "waiting on you" inbox (approvals.list), groups it by module, and lets the
 * executive approve/reject inline. Reason-required actions (e.g. executive
 * decisions) reveal a reason field before they can be confirmed. Acting is
 * optimistic; a refusal from the desktop's guards (RBAC / budget / contract /
 * reason-required) is surfaced and the inbox is refetched to restore truth.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CompanionApprovalItem } from '@neuropause/shared';
import { useCompanion } from '../state/CompanionProvider';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import {
  actIntent,
  approvalKey,
  groupByModule,
  statusToneColor,
  type ActionKind,
} from '../state/approvalsModel';
import { colors, font, radius, space } from '../theme/tokens';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ApprovalCard({
  item,
  acting,
  onAct,
}: {
  item: CompanionApprovalItem;
  acting: boolean;
  onAct: (item: CompanionApprovalItem, kind: ActionKind, reason: string) => void;
}): JSX.Element {
  const [pendingKind, setPendingKind] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState('');

  const tap = (kind: ActionKind) => {
    const intent = actIntent(item, kind, reason);
    if (!intent.available) return;
    if (intent.needsReason && pendingKind !== kind) {
      setPendingKind(kind);
      return;
    }
    if (intent.reasonMissing) return;
    onAct(item, kind, reason);
  };

  const tone = statusToneColor(item.statusTone);
  const canApprove = actIntent(item, 'approve').available;
  const canReject = actIntent(item, 'reject').available;
  const confirmDisabled = pendingKind ? actIntent(item, pendingKind, reason).reasonMissing : false;
  const created = fmtDate(item.createdAt);

  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={[styles.pill, { borderColor: tone }]}>
          <View style={[styles.pillDot, { backgroundColor: tone }]} />
          <Text style={[styles.pillText, { color: tone }]} numberOfLines={1}>
            {item.statusLabel}
          </Text>
        </View>
      </View>

      {item.fields.length > 0 ? (
        <View style={styles.fields}>
          {item.fields.map((f, i) => (
            <View key={`${f.label}-${i}`} style={styles.fieldRow}>
              <Text style={styles.fieldLabel} numberOfLines={1}>
                {f.label}
              </Text>
              <Text style={styles.fieldValue} numberOfLines={1}>
                {f.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {created ? <Text style={styles.created}>Raised {created}</Text> : null}

      {pendingKind ? (
        <TextInput
          style={styles.reason}
          placeholder={`Reason to ${pendingKind}…`}
          placeholderTextColor={colors.faint}
          value={reason}
          onChangeText={setReason}
          multiline
          editable={!acting}
        />
      ) : null}

      <View style={styles.actions}>
        {acting ? (
          <ActivityIndicator color={colors.accent} />
        ) : pendingKind ? (
          <>
            <Pressable
              onPress={() => {
                setPendingKind(null);
                setReason('');
              }}
              style={[styles.btn, styles.btnGhost]}
            >
              <Text style={styles.btnGhostLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => tap(pendingKind)}
              disabled={confirmDisabled}
              style={[
                styles.btn,
                pendingKind === 'approve' ? styles.btnApprove : styles.btnReject,
                confirmDisabled && styles.btnDisabled,
              ]}
            >
              <Text style={styles.btnLabel}>
                {pendingKind === 'approve' ? 'Confirm approve' : 'Confirm reject'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {canReject ? (
              <Pressable onPress={() => tap('reject')} style={[styles.btn, styles.btnReject]}>
                <Text style={styles.btnLabel}>Reject</Text>
              </Pressable>
            ) : null}
            {canApprove ? (
              <Pressable onPress={() => tap('approve')} style={[styles.btn, styles.btnApprove]}>
                <Text style={styles.btnLabel}>Approve</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

export function ApprovalsScreen(): JSX.Element {
  const { rpc } = useCompanion();
  const [items, setItems] = useState<CompanionApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await rpc<CompanionApprovalItem[]>('approvals.list'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load approvals.');
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAct = useCallback(
    async (item: CompanionApprovalItem, kind: ActionKind, reason: string) => {
      const intent = actIntent(item, kind, reason);
      if (!intent.available || !intent.action || intent.reasonMissing) return;
      const key = approvalKey(item);
      const trimmed = reason.trim();
      setActingKey(key);
      setActError(null);
      setItems((list) => list.filter((i) => approvalKey(i) !== key)); // optimistic
      try {
        await rpc('approvals.act', {
          moduleId: item.moduleId,
          id: item.id,
          action: intent.action,
          ...(trimmed ? { reason: trimmed } : {}),
        });
      } catch (err) {
        setActError(`${item.title}: ${err instanceof Error ? err.message : 'Action refused.'}`);
        await load(); // restore truth from the desktop
      } finally {
        setActingKey(null);
      }
    },
    [rpc, load],
  );

  if (loading && items.length === 0) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (error && items.length === 0) {
    return (
      <Screen onRefresh={load} refreshing={loading}>
        <Card title="Couldn’t load approvals">
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.hint}>Pull down to retry.</Text>
        </Card>
      </Screen>
    );
  }

  const groups = groupByModule(items);
  return (
    <Screen onRefresh={load} refreshing={loading}>
      <Text style={styles.h1}>Approvals</Text>

      {actError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{actError}</Text>
        </View>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <Text style={styles.calmTitle}>You’re all caught up.</Text>
          <Text style={styles.hint}>Nothing is waiting on your decision right now.</Text>
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.moduleId} title={`${group.moduleTitle} · ${group.items.length}`}>
            <View style={styles.itemList}>
              {group.items.map((item) => (
                <ApprovalCard
                  key={approvalKey(item)}
                  item={item}
                  acting={actingKey === approvalKey(item)}
                  onAct={onAct}
                />
              ))}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: space.xxl * 2, alignItems: 'center' },
  h1: { color: colors.ink, fontSize: font.h1, fontWeight: '800' },
  banner: {
    backgroundColor: 'rgba(226,80,79,0.14)',
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
  bannerText: { color: colors.danger, fontSize: font.small },
  calmTitle: { color: colors.ink, fontSize: font.body, fontWeight: '600' },
  itemList: { gap: space.md },
  item: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.md,
    gap: space.sm,
  },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  itemTitle: { color: colors.ink, fontSize: font.body, fontWeight: '600', flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: font.tiny, fontWeight: '600' },
  fields: { gap: space.xs, marginTop: space.xs },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  fieldLabel: { color: colors.faint, fontSize: font.small },
  fieldValue: { color: colors.muted, fontSize: font.small, flexShrink: 1, textAlign: 'right' },
  created: { color: colors.faint, fontSize: font.tiny },
  reason: {
    backgroundColor: colors.bg,
    borderColor: colors.hairline,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    color: colors.ink,
    fontSize: font.small,
    padding: space.sm,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  btn: {
    minHeight: 40,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnApprove: { backgroundColor: colors.bands.healthy },
  btnReject: { backgroundColor: colors.danger },
  btnGhost: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  btnDisabled: { opacity: 0.4 },
  btnLabel: { color: '#fff', fontSize: font.small, fontWeight: '700' },
  btnGhostLabel: { color: colors.muted, fontSize: font.small, fontWeight: '600' },
  error: { color: colors.danger, fontSize: font.body },
  hint: { color: colors.muted, fontSize: font.small, lineHeight: 20 },
});
