/**
 * NeuroPause OS — Wave 2 / Slice 13. The middle seam of the assistant→panel flow: the "Open connectors" navigation
 * button forwards `envelope.mailIntent` to `onOpenNavigation`, so AssistantHost can stash it for the M365WritePanel.
 * Component-level (jsdom) — the real-Electron click-through is Slice 14.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AssistantConversation, AssistantEnvelope } from '@neuropause/shared';
import { AssistantView } from '@renderer/assistant/AssistantView';

afterEach(() => cleanup());

function conversationWithMailIntent(): AssistantConversation {
  const envelope = {
    correlationId: 'c1',
    mode: 'ask',
    intent: { intent: 'unclear', confidence: 0, matched: [] },
    clarification: null,
    text: 'I prepared an email for your review.',
    findings: [],
    recommendations: [],
    draft: null,
    mailIntent: { to: ['alice@example.com'], subject: 'Report', body: 'Attached.' },
    navigation: { section: 'connectors', query: null },
    plan: null,
    sources: [],
    toolCalls: [],
    confidence: 0.9,
    grounded: true,
    aiOffline: false,
    unavailable: [],
    assumptions: [],
    reasoningSummary: null,
    trace: { phases: [] },
    memoryCapture: null,
    generatedAt: '2026-01-01T00:00:00Z',
  } as unknown as AssistantEnvelope;
  return {
    id: 'conv1',
    workspaceId: null,
    title: 'T',
    pinned: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    parent: null,
    messages: [
      { id: 'u1', role: 'user', at: '2026-01-01T00:00:00Z', text: 'Email alice@example.com the report.', envelope: null, redactions: [] },
      { id: 'a1', role: 'assistant', at: '2026-01-01T00:00:00Z', text: 'prepared', envelope, redactions: [] },
    ],
  } as unknown as AssistantConversation;
}

const noop = (): void => undefined;

describe('Slice 13 — assistant navigation forwards the mail intent', () => {
  it('clicking "Open connectors" passes envelope.mailIntent to onOpenNavigation', () => {
    const onOpenNavigation = vi.fn();
    render(
      <AssistantView
        conversation={conversationWithMailIntent()}
        summaries={[]}
        mode="ask"
        onModeChange={noop}
        busy={false}
        liveNote={null}
        onSubmit={noop}
        onDecide={noop}
        onCancel={noop}
        onBranch={noop}
        onPick={noop}
        onNew={noop}
        onTogglePin={noop}
        onDelete={noop}
        onOpenNavigation={onOpenNavigation}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open connectors/i }));
    expect(onOpenNavigation).toHaveBeenCalledWith('connectors', null, { to: ['alice@example.com'], subject: 'Report', body: 'Attached.' });
  });
});
