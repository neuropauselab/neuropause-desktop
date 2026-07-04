import { describe, expect, it } from 'vitest';
import {
  COMMAND_REGISTRY,
  filterCommands,
  quickActionsFor,
  resolveCommand,
  voiceResponseToResolution,
  type CommandId,
  type UnifiedCommand,
  type VoiceResponse,
} from '@neuropause/shared';

function cmd(id: CommandId, over: Partial<UnifiedCommand> = {}): UnifiedCommand {
  return { id, source: 'command-palette', ...over };
}

describe('COMMAND_REGISTRY', () => {
  it('has a resolution for every registered command (router is total)', () => {
    for (const descriptor of COMMAND_REGISTRY) {
      // resolveCommand must not throw for any registered id
      expect(() => resolveCommand(cmd(descriptor.id))).not.toThrow();
    }
  });

  it('has unique command ids', () => {
    const ids = COMMAND_REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveCommand', () => {
  it('navigation commands resolve to deep-links', () => {
    expect(resolveCommand(cmd('open.founder'))).toMatchObject({
      kind: 'navigate',
      deepLink: 'ai-workforce/founder',
    });
    expect(resolveCommand(cmd('open.organization'))).toMatchObject({
      kind: 'navigate',
      deepLink: 'enterprise/organization',
    });
    expect(resolveCommand(cmd('open.executive-center'))).toMatchObject({
      kind: 'navigate',
      deepLink: 'enterprise/executive',
    });
  });

  it('search commands carry the query into existing search', () => {
    const r = resolveCommand(cmd('search.organizations', { payload: 'acme' }));
    expect(r.kind).toBe('search');
    expect(r.query).toBe('acme');
  });

  it('action commands are governance-gated', () => {
    const r = resolveCommand(cmd('action.create-task'));
    expect(r.kind).toBe('action');
    expect(r.actionId).toBe('create-task');
    expect(r.requiresApproval).toBe(true);
  });

  it('start voice session is a UI effect', () => {
    expect(resolveCommand(cmd('voice.start-session'))).toMatchObject({
      kind: 'ui',
      uiEffect: 'open-voice',
    });
  });

  it('org health view routes through the intelligence pipeline', () => {
    const r = resolveCommand(cmd('org.view-health'));
    expect(r.kind).toBe('intelligence');
    expect(r.intelligence).toBe('org-health');
  });

  it('notification snooze/dismiss carry the notification context id', () => {
    const r = resolveCommand(
      cmd('notification.snooze', { source: 'notification', contextId: 'notif-42' }),
    );
    expect(r.kind).toBe('action');
    expect(r.actionId).toBe('snooze');
    expect(r.deepLink).toBe('notif-42');
  });
});

describe('voiceResponseToResolution', () => {
  it('maps a voice action into a governed action resolution', () => {
    const v: VoiceResponse = {
      speech: 'ok',
      intent: 'action',
      actionId: 'create-task',
      requiresApproval: true,
    };
    const r = voiceResponseToResolution(v);
    expect(r).toMatchObject({ kind: 'action', actionId: 'create-task', requiresApproval: true });
  });

  it('maps a voice navigation into a navigate resolution', () => {
    const v: VoiceResponse = {
      speech: 'opening',
      intent: 'org-health',
      deepLink: 'enterprise/organization',
    };
    expect(voiceResponseToResolution(v)).toMatchObject({
      kind: 'navigate',
      deepLink: 'enterprise/organization',
    });
  });

  it('a pure spoken answer resolves to a no-op UI resolution', () => {
    const v: VoiceResponse = { speech: 'engineering is healthy', intent: 'engineering-health' };
    expect(voiceResponseToResolution(v).kind).toBe('ui');
  });
});

describe('quickActionsFor', () => {
  it('organization screen exposes health/report/notify', () => {
    const ids = quickActionsFor('organization').map((c) => c.id);
    expect(ids).toContain('org.view-health');
    expect(ids).toContain('action.generate-report');
    expect(ids).toContain('org.notify-members');
  });

  it('mission brief screen exposes explain/export/share', () => {
    const ids = quickActionsFor('briefings').map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['brief.explain', 'brief.export', 'brief.share']));
  });

  it('engineering screen exposes issue/failures/notify', () => {
    const ids = quickActionsFor('ai-workforce/engineering').map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['eng.open-issue', 'eng.view-failures', 'action.notify-team']),
    );
  });

  it('unknown screen has no quick actions', () => {
    expect(quickActionsFor('settings')).toHaveLength(0);
  });
});

describe('filterCommands', () => {
  it('empty query returns the whole registry', () => {
    expect(filterCommands('')).toHaveLength(COMMAND_REGISTRY.length);
  });

  it('matches by title and keyword', () => {
    expect(filterCommands('founder').some((c) => c.id === 'open.founder')).toBe(true);
    expect(filterCommands('talk').some((c) => c.id === 'voice.start-session')).toBe(true);
    expect(filterCommands('ci').some((c) => c.id === 'eng.view-failures')).toBe(true);
  });

  it('non-matching query returns nothing', () => {
    expect(filterCommands('zzzzz')).toHaveLength(0);
  });
});
