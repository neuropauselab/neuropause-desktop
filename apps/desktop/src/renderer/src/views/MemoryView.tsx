import { ModulePreview } from './ModulePreview';

export function MemoryView(): JSX.Element {
  return (
    <ModulePreview
      icon="memory"
      tone="purple"
      title="AI Memory"
      phase={6}
      tagline="Search everything you’ve worked on across every AI app, in plain language."
      features={[
        { icon: 'search', title: 'Ask anything', body: 'Find past work by describing it, not by remembering where it lived.' },
        { icon: 'sparkles', title: 'Auto-captured', body: 'Sessions and outputs are remembered as you work — nothing to file.' },
        { icon: 'clock', title: 'Timeline recall', body: 'Jump back to any moment and pick up exactly where you left off.' },
        { icon: 'connectors', title: 'Cross-app', body: 'One memory that spans chats, code, docs, and designs.' },
      ]}
    />
  );
}
