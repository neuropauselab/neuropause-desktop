import { ModulePreview } from './ModulePreview';

export function AutomationsView(): JSX.Element {
  return (
    <ModulePreview
      icon="automations"
      tone="orange"
      title="Automations"
      phase={6}
      tagline="Chain your AI apps into workflows that run on a schedule or a trigger."
      features={[
        { icon: 'automations', title: 'Visual builder', body: 'Compose multi-step flows across apps without writing code.' },
        { icon: 'clock', title: 'Schedules & triggers', body: 'Run on a timer, an event, or when activity meets a condition.' },
        { icon: 'sparkles', title: 'AI steps', body: 'Drop summarize, draft, and classify steps into any workflow.' },
        { icon: 'bell', title: 'Notifications', body: 'Get notified when a run finishes or needs your input.' },
      ]}
    />
  );
}
