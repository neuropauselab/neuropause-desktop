/**
 * AssistantHost (Phase 6 Stage 4) — binds the Workspace Assistant experience to
 * the documented `assistant:*` IPC cluster. Owns conversation state, the mode,
 * live progress from the `assistant:event` broadcast, approval decisions,
 * cancel/branch/history, and the hand-offs in (⌘K / Mission Control) and out
 * (navigation resolutions; search hand-off reuses Stage 3's mailbox).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssistantConversation,
  AssistantConversationSummary,
  AssistantEvent,
  AssistantMode,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import type { SectionId } from '@renderer/shell/sections';
import { setPendingSearchQuery } from '@renderer/search/searchHandoff';
import { consumePendingAssistantQuery } from './assistantHandoff';
import { AssistantView } from './AssistantView';

export function AssistantHost({ onNavigate }: { onNavigate?: (id: SectionId) => void }): JSX.Element {
  const [conversation, setConversation] = useState<AssistantConversation | null>(null);
  const [summaries, setSummaries] = useState<AssistantConversationSummary[]>([]);
  const [mode, setMode] = useState<AssistantMode>('ask');
  const [busy, setBusy] = useState(false);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  conversationRef.current = conversation?.id ?? null;

  const refreshList = useCallback((): void => {
    ipc.assistant
      .conversations()
      .then((r) => setSummaries(r.conversations))
      .catch(() => setSummaries([]));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Live progress: phase notes while a turn runs; step changes refresh the thread.
  useEffect(() => {
    const off = ipc.assistant.onEvent((event: AssistantEvent) => {
      if (event.kind === 'phase') {
        setLiveNote(event.phase === 'done' ? null : `…${event.phase}`);
      }
      if (event.kind === 'step' && event.conversationId === conversationRef.current) {
        ipc.assistant
          .conversation(event.conversationId)
          .then((c) => {
            if (c && c.id === conversationRef.current) setConversation(c);
          })
          .catch(() => undefined);
      }
    });
    return off;
  }, []);

  const submit = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setLiveNote('…starting');
      try {
        const result = await ipc.assistant.ask({
          text: trimmed,
          mode,
          ...(conversationRef.current ? { conversationId: conversationRef.current } : {}),
          uiContext: { section: 'assistant' },
        });
        setConversation(result.conversation);
        refreshList();
      } catch {
        // The turn itself failed at the IPC layer — surface an honest note.
        setLiveNote('The assistant call failed — check AI settings and try again.');
        setBusy(false);
        return;
      }
      setLiveNote(null);
      setBusy(false);
    },
    [busy, mode, refreshList],
  );

  // Hand-off in: a query staged by ⌘K or Mission Control runs on mount.
  useEffect(() => {
    const pending = consumePendingAssistantQuery();
    if (pending) void submit(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount consumption
  }, []);

  const onDecide = useCallback(
    async (messageId: string, stepId: string, decision: 'approve' | 'reject'): Promise<void> => {
      const id = conversationRef.current;
      if (!id) return;
      try {
        const updated = await ipc.assistant.decideStep({ conversationId: id, messageId, stepId, decision });
        if (updated) setConversation(updated);
      } catch {
        setLiveNote('Approval failed — you may lack the workforce:operate permission.');
      }
    },
    [],
  );

  const onCancel = useCallback((): void => {
    const id = conversationRef.current;
    if (id) void ipc.assistant.cancel(id).catch(() => undefined);
  }, []);

  const onBranch = useCallback(async (messageId: string): Promise<void> => {
    const id = conversationRef.current;
    if (!id) return;
    const branched = await ipc.assistant.branch(id, messageId).catch(() => null);
    if (branched) {
      setConversation(branched);
      refreshList();
    }
  }, [refreshList]);

  const onPick = useCallback((id: string): void => {
    ipc.assistant
      .conversation(id)
      .then((c) => {
        if (c) setConversation(c);
      })
      .catch(() => undefined);
  }, []);

  const onNew = useCallback((): void => setConversation(null), []);

  const onTogglePin = useCallback(
    (id: string, pinned: boolean): void => {
      void ipc.assistant
        .save({ conversationId: id, pinned })
        .then((c) => {
          if (c && c.id === conversationRef.current) setConversation(c);
          refreshList();
        })
        .catch(() => undefined);
    },
    [refreshList],
  );

  const onDelete = useCallback(
    (id: string): void => {
      void ipc.assistant
        .remove(id)
        .then(() => {
          if (conversationRef.current === id) setConversation(null);
          refreshList();
        })
        .catch(() => undefined);
    },
    [refreshList],
  );

  const onOpenNavigation = useCallback(
    (section: string, query: string | null): void => {
      if (section === 'search' && query) setPendingSearchQuery(query);
      onNavigate?.(section as SectionId);
    },
    [onNavigate],
  );

  return (
    <AssistantView
      conversation={conversation}
      summaries={summaries}
      mode={mode}
      onModeChange={setMode}
      busy={busy}
      liveNote={liveNote}
      onSubmit={(text) => void submit(text)}
      onDecide={(messageId, stepId, decision) => void onDecide(messageId, stepId, decision)}
      onCancel={onCancel}
      onBranch={(messageId) => void onBranch(messageId)}
      onPick={onPick}
      onNew={onNew}
      onTogglePin={onTogglePin}
      onDelete={onDelete}
      onOpenNavigation={onOpenNavigation}
    />
  );
}
