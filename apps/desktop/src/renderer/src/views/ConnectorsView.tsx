import { ModulePreview } from './ModulePreview';

export function ConnectorsView(): JSX.Element {
  return (
    <ModulePreview
      icon="connectors"
      tone="teal"
      title="Connectors"
      phase={4}
      tagline="Securely link your AI accounts so NeuroPause can act on your behalf."
      features={[
        { icon: 'connectors', title: 'OAuth sign-in', body: 'Connect accounts with secure, revocable OAuth — no passwords stored.' },
        { icon: 'settings', title: 'Granular scopes', body: 'Grant only the access each app needs, and revoke any time.' },
        { icon: 'activity', title: 'Two-way sync', body: 'Bring activity in and push actions out across your tools.' },
        { icon: 'memory', title: 'Unified identity', body: 'One place to see and manage every linked AI service.' },
      ]}
    />
  );
}
