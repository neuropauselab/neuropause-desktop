import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  planAutomation,
  validateAutomationRule,
  type AutomationAction,
  type AutomationActionType,
  type AutomationCondition,
  type AutomationRule,
  type AutomationTrigger,
  type AutomationTriggerType,
  type ConditionOperator,
} from '@neuropause/shared';
import { ipc } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/cn';
import { Card } from '@renderer/components/ui/Card';
import { Button } from '@renderer/components/ui/Button';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Spinner } from '@renderer/components/Spinner';
import { Toggle } from '@renderer/components/ui/controls';
import { ViewHeader, ViewScroll } from '@renderer/components/ui/Page';
import { TEXT_TONE, TINT_TONE, type OpsTone } from '@renderer/operations/lib';

let seq = 0;
const uid = (p: string): string => `${p}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  'connector-event': 'Connector event',
  schedule: 'Schedule',
  manual: 'Manual',
  'activity-event': 'Activity event',
};

const ACTION_LABELS: Record<AutomationActionType, string> = {
  'ai-summarize': 'Summarize with AI',
  'ai-generate': 'Generate with AI',
  'connector-write': 'Write to connector',
  notify: 'Send notification',
  'save-memory': 'Save to memory',
  'create-reminder': 'Create reminder',
};

const OPERATORS: ConditionOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'exists',
  'not_exists',
];

const CONNECTOR_ACTIONS: AutomationActionType[] = ['connector-write', 'notify'];

function statusTone(status: AutomationRule['status']): OpsTone {
  return status === 'active'
    ? 'green'
    : status === 'error'
      ? 'red'
      : status === 'paused'
        ? 'orange'
        : 'gray';
}

function newRule(): AutomationRule {
  const now = new Date().toISOString();
  return {
    id: uid('auto'),
    name: 'Untitled automation',
    description: '',
    trigger: { type: 'manual' },
    conditions: [],
    conditionLogic: 'all',
    actions: [
      { id: uid('act'), type: 'notify', label: ACTION_LABELS.notify, connectorId: 'desktop' },
    ],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Automation Builder (V4.6) — the production visual editor for Module 9. Rule list
 * + Trigger → Condition → Action editor, live validation via validateAutomationRule,
 * execution preview via planAutomation, persistence via ipc.automations. Reuses the
 * V4.4 engine + V4.5 store; no duplicated rule logic.
 */
export function AutomationBuilder(): JSX.Element {
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveIssues, setSaveIssues] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const r = await ipc.automations.list();
      setRules(r.rules);
    } catch {
      setRules([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rules ?? [];
    if (!q) return list;
    return list.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
    );
  }, [rules, query]);

  if (editing) {
    return (
      <RuleEditor
        rule={editing}
        saving={saving}
        issues={saveIssues}
        onCancel={() => {
          setEditing(null);
          setSaveIssues([]);
        }}
        onSave={async (rule) => {
          setSaving(true);
          setSaveIssues([]);
          try {
            const res = await ipc.automations.save(rule);
            if (!res.ok) {
              setSaveIssues(res.issues ?? ['Could not save automation.']);
              return;
            }
            await refresh();
            setEditing(null);
          } finally {
            setSaving(false);
          }
        }}
      />
    );
  }

  return (
    <ViewScroll max={860}>
      <ViewHeader
        title="Automations"
        subtitle="Chain triggers, conditions, and actions into workflows that run for you."
        right={
          <Button variant="primary" onClick={() => setEditing(newRule())}>
            <Icon name="plus" size={15} /> New automation
          </Button>
        }
      />

      {rules === null ? (
        <div className="flex items-center gap-2 py-8 text-xs text-white/40">
          <Spinner size={14} /> Loading automations…
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon="automations"
          title="No automations yet"
          description="Create your first automation to summarize an email, save it to Notion, or notify your team — automatically."
          action={
            <Button variant="primary" onClick={() => setEditing(newRule())}>
              <Icon name="plus" size={15} /> New automation
            </Button>
          }
        />
      ) : (
        <>
          <div className="relative mb-3">
            <Icon
              name="search"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search automations…"
              aria-label="Search automations"
              className="w-full rounded-xl border border-[var(--hairline)] [background:var(--fill-1)] py-2 pl-8 pr-3 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
            />
          </div>
          <div className="space-y-2">
            {filtered.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onEdit={() => setEditing(rule)}
                onToggle={async () => {
                  await ipc.automations.setStatus(
                    rule.id,
                    rule.status === 'active' ? 'paused' : 'active',
                  );
                  await refresh();
                }}
                onDuplicate={async () => {
                  const copy: AutomationRule = {
                    ...rule,
                    id: uid('auto'),
                    name: `${rule.name} (copy)`,
                    status: 'draft',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  };
                  await ipc.automations.save(copy);
                  await refresh();
                }}
                onDelete={async () => {
                  await ipc.automations.remove(rule.id);
                  await refresh();
                }}
              />
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-white/30">
                No automations match your search.
              </p>
            )}
          </div>
        </>
      )}
    </ViewScroll>
  );
}

function RuleRow({
  rule,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  rule: AutomationRule;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): JSX.Element {
  const tone = statusTone(rule.status);
  const steps = rule.actions.length;
  return (
    <Card variant="flat" flush className="p-3.5">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onEdit}
          className="min-w-0 flex-1 text-left outline-none focus-visible:shadow-focus"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink">{rule.name}</span>
            <span
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase',
                TINT_TONE[tone],
                TEXT_TONE[tone],
              )}
            >
              {rule.status}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-white/40">
            {TRIGGER_LABELS[rule.trigger.type]} · {steps} action{steps === 1 ? '' : 's'}
            {rule.conditions.length > 0
              ? ` · ${rule.conditions.length} condition${rule.conditions.length === 1 ? '' : 's'}`
              : ''}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Toggle
            checked={rule.status === 'active'}
            onChange={onToggle}
            label={`Enable ${rule.name}`}
          />
          <IconButton icon="clipboard" label="Duplicate" onClick={onDuplicate} />
          <IconButton icon="trash" label="Delete" onClick={onDelete} />
        </div>
      </div>
    </Card>
  );
}

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-lg p-1.5 text-white/40 outline-none transition hover:bg-white/5 hover:text-white/80 focus-visible:shadow-focus"
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

function RuleEditor({
  rule: initial,
  saving,
  issues,
  onSave,
  onCancel,
}: {
  rule: AutomationRule;
  saving: boolean;
  issues: string[];
  onSave: (rule: AutomationRule) => void;
  onCancel: () => void;
}): JSX.Element {
  const [rule, setRule] = useState<AutomationRule>(initial);
  const patch = (p: Partial<AutomationRule>) =>
    setRule((r) => ({ ...r, ...p, updatedAt: new Date().toISOString() }));

  const validation = useMemo(() => validateAutomationRule(rule), [rule]);
  const plan = useMemo(() => planAutomation(rule), [rule]);

  return (
    <ViewScroll max={860}>
      <ViewHeader
        title={rule.name || 'Untitled automation'}
        subtitle="Compose the trigger, conditions, and actions. Validation runs as you edit."
        right={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={!validation.valid}
              onClick={() => onSave(rule)}
            >
              Save automation
            </Button>
          </div>
        }
      />

      {/* Name + description */}
      <Section label="Details">
        <div className="space-y-2.5">
          <LabeledInput
            label="Name"
            value={rule.name}
            onChange={(v) => patch({ name: v })}
            placeholder="e.g. Summarize investor emails"
          />
          <LabeledInput
            label="Description"
            value={rule.description ?? ''}
            onChange={(v) => patch({ description: v })}
            placeholder="Optional — what this automation does"
          />
        </div>
      </Section>

      {/* Trigger */}
      <Section label="Trigger" hint="When this happens">
        <TriggerEditor trigger={rule.trigger} onChange={(trigger) => patch({ trigger })} />
      </Section>

      {/* Conditions */}
      <Section
        label="Conditions"
        hint="Only continue if…"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              patch({
                conditions: [...rule.conditions, { field: '', operator: 'equals', value: '' }],
              })
            }
          >
            <Icon name="plus" size={13} /> Add condition
          </Button>
        }
      >
        {rule.conditions.length === 0 ? (
          <p className="px-1 py-2 text-xs text-white/40">
            No conditions — this automation runs every time the trigger fires.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <span>Match</span>
              <select
                value={rule.conditionLogic}
                onChange={(e) => patch({ conditionLogic: e.target.value as 'all' | 'any' })}
                aria-label="Condition logic"
                className="rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2 py-1 text-xs text-ink outline-none focus-visible:shadow-focus"
              >
                <option value="all">all conditions (AND)</option>
                <option value="any">any condition (OR)</option>
              </select>
            </div>
            {rule.conditions.map((c, i) => (
              <ConditionEditor
                key={i}
                condition={c}
                onChange={(next) => {
                  const conditions = [...rule.conditions];
                  conditions[i] = next;
                  patch({ conditions });
                }}
                onRemove={() =>
                  patch({ conditions: rule.conditions.filter((_, idx) => idx !== i) })
                }
              />
            ))}
          </div>
        )}
      </Section>

      {/* Actions */}
      <Section
        label="Actions"
        hint="Then do this"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              patch({
                actions: [
                  ...rule.actions,
                  {
                    id: uid('act'),
                    type: 'notify',
                    label: ACTION_LABELS.notify,
                    connectorId: 'desktop',
                  },
                ],
              })
            }
          >
            <Icon name="plus" size={13} /> Add action
          </Button>
        }
      >
        <div className="space-y-2">
          {rule.actions.map((a, i) => (
            <ActionEditor
              key={a.id}
              action={a}
              index={i}
              onChange={(next) => {
                const actions = [...rule.actions];
                actions[i] = next;
                patch({ actions });
              }}
              onRemove={() => patch({ actions: rule.actions.filter((_, idx) => idx !== i) })}
              onMove={(dir) => {
                const actions = [...rule.actions];
                const j = dir === 'up' ? i - 1 : i + 1;
                if (j < 0 || j >= actions.length) return;
                [actions[i], actions[j]] = [actions[j], actions[i]];
                patch({ actions });
              }}
            />
          ))}
        </div>
      </Section>

      {/* Preview + validation */}
      <Section label="Preview" hint="Execution order">
        <Card variant="flat" flush className="p-3">
          <ol className="space-y-1.5">
            {plan.map((step) => (
              <li key={step.order} className="flex items-center gap-2 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full [background:var(--fill-2)] text-[10px] text-white/50">
                  {step.order + 1}
                </span>
                <span className="text-white/40">
                  {step.kind === 'trigger'
                    ? 'Trigger'
                    : step.kind === 'condition-gate'
                      ? 'Gate'
                      : 'Action'}
                </span>
                <span className="text-ink">{step.label}</span>
              </li>
            ))}
          </ol>
        </Card>
        {!validation.valid && (
          <div className="mt-2 space-y-1">
            {validation.issues.map((issue, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-rose-300/90">
                <Icon name="info" size={13} /> {issue.message}
              </div>
            ))}
          </div>
        )}
        {issues.length > 0 && (
          <div className="mt-2 space-y-1">
            {issues.map((issue, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-rose-300/90">
                <Icon name="info" size={13} /> {issue}
              </div>
            ))}
          </div>
        )}
      </Section>
    </ViewScroll>
  );
}

function TriggerEditor({
  trigger,
  onChange,
}: {
  trigger: AutomationTrigger;
  onChange: (t: AutomationTrigger) => void;
}): JSX.Element {
  return (
    <div className="space-y-2.5">
      <LabeledSelect
        label="Type"
        value={trigger.type}
        options={(Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]).map((t) => ({
          value: t,
          label: TRIGGER_LABELS[t],
        }))}
        onChange={(v) => onChange({ ...trigger, type: v as AutomationTriggerType })}
      />
      {trigger.type === 'connector-event' && (
        <div className="grid grid-cols-2 gap-2">
          <LabeledInput
            label="Connector"
            value={trigger.connectorId ?? ''}
            onChange={(v) => onChange({ ...trigger, connectorId: v })}
            placeholder="e.g. gmail"
          />
          <LabeledInput
            label="Event"
            value={trigger.event ?? ''}
            onChange={(v) => onChange({ ...trigger, event: v })}
            placeholder="e.g. message.received"
          />
        </div>
      )}
      {trigger.type === 'schedule' && (
        <LabeledInput
          label="Schedule"
          value={trigger.schedule ?? ''}
          onChange={(v) => onChange({ ...trigger, schedule: v })}
          placeholder="e.g. daily 9am"
        />
      )}
      {trigger.type === 'activity-event' && (
        <LabeledInput
          label="Event"
          value={trigger.event ?? ''}
          onChange={(v) => onChange({ ...trigger, event: v })}
          placeholder="e.g. task.completed"
        />
      )}
    </div>
  );
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
}: {
  condition: AutomationCondition;
  onChange: (c: AutomationCondition) => void;
  onRemove: () => void;
}): JSX.Element {
  const needsValue = condition.operator !== 'exists' && condition.operator !== 'not_exists';
  return (
    <div className="flex items-center gap-2">
      <input
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value })}
        placeholder="field"
        aria-label="Condition field"
        className="min-w-0 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2 py-1.5 text-xs text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
      />
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator })}
        aria-label="Condition operator"
        className="shrink-0 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2 py-1.5 text-xs text-ink outline-none focus-visible:shadow-focus"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {needsValue && (
        <input
          value={String(condition.value ?? '')}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          placeholder="value"
          aria-label="Condition value"
          className="min-w-0 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2 py-1.5 text-xs text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
        />
      )}
      <IconButton icon="close" label="Remove condition" onClick={onRemove} />
    </div>
  );
}

function ActionEditor({
  action,
  index,
  onChange,
  onRemove,
  onMove,
}: {
  action: AutomationAction;
  index: number;
  onChange: (a: AutomationAction) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
}): JSX.Element {
  const needsConnector = CONNECTOR_ACTIONS.includes(action.type);
  return (
    <Card variant="flat" flush className="p-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full [background:var(--fill-2)] text-[10px] text-white/50">
          {index + 1}
        </span>
        <select
          value={action.type}
          onChange={(e) => {
            const type = e.target.value as AutomationActionType;
            onChange({ ...action, type, label: ACTION_LABELS[type] });
          }}
          aria-label="Action type"
          className="min-w-0 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2 py-1.5 text-xs text-ink outline-none focus-visible:shadow-focus"
        >
          {(Object.keys(ACTION_LABELS) as AutomationActionType[]).map((t) => (
            <option key={t} value={t}>
              {ACTION_LABELS[t]}
            </option>
          ))}
        </select>
        {needsConnector && (
          <input
            value={action.connectorId ?? ''}
            onChange={(e) => onChange({ ...action, connectorId: e.target.value })}
            placeholder="connector (e.g. slack)"
            aria-label="Action connector"
            className="min-w-0 flex-1 rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2 py-1.5 text-xs text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
          />
        )}
        <div className="flex shrink-0 items-center">
          <IconButton icon="arrow-up" label="Move up" onClick={() => onMove('up')} />
          <IconButton icon="chevron-down" label="Move down" onClick={() => onMove('down')} />
          <IconButton icon="close" label="Remove action" onClick={onRemove} />
        </div>
      </div>
    </Card>
  );
}

// ── small building blocks ──

function Section({
  label,
  hint,
  action,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
            {label}
          </h3>
          {hint && <span className="text-[11px] text-white/30">{hint}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/40">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-faint focus-visible:shadow-focus"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--hairline)] [background:var(--fill-1)] px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:shadow-focus"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
