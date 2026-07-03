import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { Button } from '@renderer/components/ui/Button';
import { formatRelative } from '@renderer/lib/format';
import { OpsPanel, StatusBadge } from './primitives';
import { TINT_TONE, type OpsTone } from './lib';
import type {
  BackupInfo,
  BackupValidation,
  RecoveryAction,
  RecoveryActionResult,
  RecoveryRecommendation,
  SafeModeState,
} from '@neuropause/shared';

interface ActionDef {
  action: RecoveryAction;
  icon: IconName;
  title: string;
  desc: string;
  destructive?: boolean;
}

const ACTIONS: ActionDef[] = [
  { action: 'disablePlugins', icon: 'puzzle', title: 'Disable Plugins', desc: 'Turn off all enabled plugins to isolate instability.' },
  { action: 'rebuildSearchIndexes', icon: 'search', title: 'Rebuild Search Indexes', desc: 'Re-index organizational memory from its source.' },
  { action: 'rebuildKnowledgeGraph', icon: 'database', title: 'Rebuild Knowledge Graph', desc: 'Re-project the graph from the Unified Data Model.' },
  { action: 'repairInstallation', icon: 'refresh', title: 'Repair Installation', desc: 'Re-verify and repair every installed app.' },
  { action: 'verifyIntegrity', icon: 'verified', title: 'Verify Package Integrity', desc: 'Check signatures and hashes of installed apps.' },
  { action: 'resetSettings', icon: 'undo', title: 'Reset Settings', desc: 'Restore app settings to defaults. Your data is untouched.', destructive: true },
];

const SEVERITY_TONE: Record<RecoveryRecommendation['severity'], OpsTone> = {
  info: 'blue',
  warning: 'orange',
  critical: 'red',
};

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Recovery Center — the operator surface for getting an installation back to a
 * good state. Surfaces crash-derived recommendations, Safe Mode, the recovery
 * actions, and backup restore. Destructive actions confirm first; every action
 * reports its real result from the main process.
 */
export function RecoveryCenterPanel(): JSX.Element {
  const [safeMode, setSafeMode] = useState<SafeModeState | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [recs, setRecs] = useState<RecoveryRecommendation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RecoveryActionResult>>({});
  const [validations, setValidations] = useState<Record<string, BackupValidation>>({});

  const load = useCallback(async () => {
    const [sm, bk, rc] = await Promise.all([
      ipc.releaseOps.safeModeStatus(),
      ipc.releaseOps.listBackups(),
      ipc.releaseOps.crashRecommendations(),
    ]);
    setSafeMode(sm);
    setBackups(bk);
    setRecs(rc);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (action: RecoveryAction, opts?: { backupId?: string }) => {
      setBusy(action + (opts?.backupId ?? ''));
      setConfirm(null);
      try {
        const result = await ipc.releaseOps.runRecovery(action, opts);
        setResults((r) => ({ ...r, [action + (opts?.backupId ?? '')]: result }));
        if (action === 'safeMode') setSafeMode(await ipc.releaseOps.safeModeStatus());
        if (action === 'restoreBackup') setBackups(await ipc.releaseOps.listBackups());
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const createBackup = useCallback(async () => {
    setBusy('create');
    try {
      await ipc.releaseOps.createBackup();
      setBackups(await ipc.releaseOps.listBackups());
    } finally {
      setBusy(null);
    }
  }, []);

  const validate = useCallback(async (id: string) => {
    setBusy('validate' + id);
    try {
      const v = await ipc.releaseOps.validateBackup(id);
      setValidations((m) => ({ ...m, [id]: v }));
    } finally {
      setBusy(null);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setBusy('delete' + id);
    setConfirm(null);
    try {
      await ipc.releaseOps.deleteBackup(id);
      setBackups(await ipc.releaseOps.listBackups());
    } finally {
      setBusy(null);
    }
  }, []);

  const runnableRec = (rec: RecoveryRecommendation): RecoveryAction | null => {
    const all = [...ACTIONS.map((a) => a.action), 'safeMode'] as string[];
    return rec.action && all.includes(rec.action) ? (rec.action as RecoveryAction) : null;
  };

  return (
    <div>
      {/* Recommendations */}
      {recs.length > 0 && (
        <OpsPanel title="Recommendations" subtitle="Derived from recent crash patterns.">
          <div className="space-y-2">
            {recs.map((rec) => {
              const tone = SEVERITY_TONE[rec.severity];
              const act = runnableRec(rec);
              return (
                <div key={rec.id} className="surface-raised flex items-start gap-3 rounded-2xl p-4 shadow-card">
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TINT_TONE[tone])}>
                    <Icon name={rec.severity === 'critical' ? 'shield' : 'info'} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{rec.title}</span>
                      <StatusBadge tone={tone} label={rec.severity} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{rec.detail}</p>
                  </div>
                  {act && (
                    <Button size="sm" variant="secondary" onClick={() => void runAction(act)} disabled={busy !== null}>
                      Run
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </OpsPanel>
      )}

      {/* Safe Mode */}
      <OpsPanel title="Safe Mode" subtitle="Launch with plugins skipped. Your plugin preferences are preserved.">
        <div className="surface-raised flex items-center gap-4 rounded-2xl p-4 shadow-card">
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', TINT_TONE[safeMode?.enabled ? 'orange' : 'gray'])}>
            <Icon name="shield" size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{safeMode?.enabled ? 'Safe Mode is armed' : 'Safe Mode is off'}</span>
              <StatusBadge tone={safeMode?.enabled ? 'orange' : 'gray'} label={safeMode?.enabled ? 'Armed' : 'Off'} />
            </div>
            <p className="mt-0.5 text-xs text-faint">
              {safeMode?.enabled
                ? `Set ${safeMode.setAt ? formatRelative(safeMode.setAt) : 'recently'}. Restart to apply, then disable to restore plugins.`
                : 'When armed, the next launch starts with all plugins disabled.'}
            </p>
          </div>
          <Button
            size="sm"
            variant={safeMode?.enabled ? 'secondary' : 'primary'}
            icon="shield"
            onClick={() => void runAction('safeMode')}
            disabled={busy !== null}
          >
            {safeMode?.enabled ? 'Disable Safe Mode' : 'Enable Safe Mode'}
          </Button>
        </div>
        <ActionResult result={results.safeMode} />
      </OpsPanel>

      {/* Recovery actions */}
      <OpsPanel title="Recovery Actions">
        <div className="grid gap-3 sm:grid-cols-2">
          {ACTIONS.map((a) => {
            const key = a.action;
            const running = busy === key;
            const awaiting = confirm === key;
            return (
              <div key={key} className="surface-raised rounded-2xl p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TINT_TONE[a.destructive ? 'orange' : 'accent'])}>
                    <Icon name={a.icon} size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{a.title}</div>
                    <p className="mt-0.5 text-xs text-faint">{a.desc}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  {awaiting ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                      <Button size="sm" variant="primary" onClick={() => void runAction(a.action)} disabled={running}>
                        Confirm
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => (a.destructive ? setConfirm(key) : void runAction(a.action))}
                      disabled={busy !== null}
                    >
                      {running ? 'Running…' : 'Run'}
                    </Button>
                  )}
                </div>
                <ActionResult result={results[key]} />
              </div>
            );
          })}
        </div>
      </OpsPanel>

      {/* Backups */}
      <OpsPanel
        title="Backups"
        subtitle="Restore protected data (registry, knowledge graph, memory, timeline, workspaces, configuration)."
        actions={
          <Button size="sm" variant="primary" icon="plus" onClick={() => void createBackup()} disabled={busy !== null}>
            {busy === 'create' ? 'Creating…' : 'Create backup'}
          </Button>
        }
      >
        {backups.length === 0 ? (
          <div className="rounded-2xl border border-[var(--hairline)] [background:var(--fill-1)] p-6 text-center text-sm text-faint">
            No backups yet. Create one now, or a scheduled backup will appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((b) => {
              const v = validations[b.id];
              const restoreKey = 'restoreBackup' + b.id;
              const restoring = busy === restoreKey;
              const confirmingRestore = confirm === restoreKey;
              const confirmingDelete = confirm === 'delete' + b.id;
              return (
                <div key={b.id} className="surface-raised rounded-2xl p-4 shadow-card">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TINT_TONE.blue)}>
                      <Icon name="package" size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{formatRelative(b.createdAt)}</span>
                        <span className="rounded-md px-1.5 py-0.5 text-2xs font-semibold capitalize [background:var(--fill-2)] text-faint">{b.trigger}</span>
                        {v && <StatusBadge tone={v.valid ? 'green' : 'red'} label={v.valid ? 'Integrity OK' : 'Integrity failed'} />}
                      </div>
                      <div className="mt-0.5 text-2xs text-faint">
                        v{b.appVersion} · {bytes(b.sizeBytes)} · {b.domains.length} domain{b.domains.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" icon="verified" onClick={() => void validate(b.id)} disabled={busy !== null}>
                        {busy === 'validate' + b.id ? '…' : 'Validate'}
                      </Button>
                      {confirmingRestore ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                          <Button size="sm" variant="primary" onClick={() => void runAction('restoreBackup', { backupId: b.id })} disabled={restoring}>
                            Confirm restore
                          </Button>
                        </>
                      ) : confirmingDelete ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                          <Button size="sm" variant="danger" onClick={() => void remove(b.id)} disabled={busy !== null}>
                            Confirm delete
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="secondary" icon="undo" onClick={() => setConfirm(restoreKey)} disabled={busy !== null}>
                            {restoring ? 'Restoring…' : 'Restore'}
                          </Button>
                          <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirm('delete' + b.id)} disabled={busy !== null} />
                        </>
                      )}
                    </div>
                  </div>
                  <ActionResult result={results[restoreKey]} />
                </div>
              );
            })}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}

/** Inline result strip shown beneath an action after it runs. */
function ActionResult({ result }: { result?: RecoveryActionResult }): JSX.Element | null {
  if (!result) return null;
  const tone: OpsTone = result.ok ? 'green' : 'red';
  return (
    <div className={cn('mt-3 flex items-start gap-2 rounded-xl p-2.5 text-xs', TINT_TONE[tone])}>
      <Icon name={result.ok ? 'check' : 'close'} size={13} className="mt-0.5 shrink-0" />
      <div>
        <span className="font-medium">{result.message}</span>
        {result.requiresRestart && <span className="ml-1 opacity-80">Restart required.</span>}
        {result.detail && <div className="mt-0.5 opacity-80">{result.detail}</div>}
      </div>
    </div>
  );
}
