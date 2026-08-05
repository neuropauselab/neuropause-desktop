/**
 * Wave 10 capability evidence matrix — the four-level HONESTY BOUNDARY encoded as data:
 *   live-verified          — workspace runtimes, documents, knowledge, notes, tasks, calendar,
 *                            chat, whiteboard, file metadata, forms, workspace AI, command center,
 *                            automation, dashboards, marketplace, SDK, and design-system components
 *                            — executed in-process
 *   adapter-verified       — email / calendar / video / storage / messaging providers and desktop
 *                            (Electron) / mobile capabilities, adapter-verified until configured
 *   business-data-pending  — real documents / chats / meetings / notes / knowledge / files;
 *                            registries start empty and are never fabricated
 *   regulated-external     — legal retention, government archiving, compliance exports, and real
 *                            email / video / storage / messaging infrastructure
 * A test asserts nothing regulated-external or business-data-pending is marked live-verified.
 */
import type { EvidenceLevel } from './types';

export interface CapabilityEvidence {
  capability: string;
  module: string;
  level: EvidenceLevel;
  note: string;
}

export const WORKSPACE_MATRIX: CapabilityEvidence[] = [
  // Live-verified — executed in-process
  { capability: 'Universal Workspace runtime', module: 'M1', level: 'live-verified', note: 'Personal/team/department/organization/shared/external workspaces.' },
  { capability: 'Universal Navigation', module: 'M2', level: 'live-verified', note: 'Sidebar, favorites, pins, recent; global search reuses the Wave 8 Enterprise Search.' },
  { capability: 'Unified Inbox', module: 'M3', level: 'live-verified', note: 'One inbox over notifications/tasks/approvals/mentions/alerts/AI suggestions.' },
  { capability: 'Enterprise Documents', module: 'M4', level: 'live-verified', note: 'Versions, templates, approval, comments — every op audited on the one chain.' },
  { capability: 'Knowledge Platform', module: 'M5', level: 'live-verified', note: 'Wiki/KB/SOP/policies/FAQs with real in-process search.' },
  { capability: 'Enterprise Notes', module: 'M6', level: 'live-verified', note: 'Personal/shared/meeting/voice notes + real extractive summary.' },
  { capability: 'Tasks & Work Management', module: 'M7', level: 'live-verified', note: 'Kanban/dependencies/priorities/recurring; project tasks REUSED from Wave 8.' },
  { capability: 'Calendar + scheduling assistant', module: 'M8', level: 'live-verified', note: 'Events/rooms/resources with real conflict detection.' },
  { capability: 'Enterprise Chat', module: 'M9', level: 'live-verified', note: 'DMs/group/channels/threads/reactions/mentions — in-process.' },
  { capability: 'Whiteboard', module: 'M11', level: 'live-verified', note: 'Boards with sticky notes/shapes/flowcharts.' },
  { capability: 'Enterprise Files (metadata)', module: 'M12', level: 'live-verified', note: 'Versioning/tags/search over metadata; bytes live in an external provider.' },
  { capability: 'Enterprise Forms', module: 'M13', level: 'live-verified', note: 'Dynamic forms/surveys/requests; form builder REUSES the Wave 9 low-code platform.' },
  { capability: 'Workspace AI', module: 'M14', level: 'live-verified', note: 'Seven assistants REUSE the Wave 8 Enterprise AI; grounded in real objects.' },
  { capability: 'Universal Command Center', module: 'M15', level: 'live-verified', note: 'AI/workflow/search/business/navigation commands dispatched in-process.' },
  { capability: 'Workspace Automation', module: 'M16', level: 'live-verified', note: 'Reuses the Wave 4 HITL gate — AI may not self-approve restricted operations.' },
  { capability: 'Enterprise Dashboards', module: 'M17', level: 'live-verified', note: "Composed from real registries; 'No business data available' when empty." },
  { capability: 'Enterprise Marketplace (install)', module: 'M18', level: 'live-verified', note: 'In-process install registry; real distribution reuses the Wave 6 marketplace.' },
  { capability: 'Workspace SDK', module: 'M19', level: 'live-verified', note: 'Register widgets/pages/commands/dashboards/panels/extensions.' },
  { capability: 'Design System components', module: 'M23', level: 'live-verified', note: 'Component + theme registry — no UI components duplicated.' },
  { capability: 'Workspace Governance', module: 'M1-M20', level: 'live-verified', note: 'Every workspace operation audited on the one runtime chain with a replay id and evidence.' },
  // Adapter-verified — external providers / device capabilities, until configured
  { capability: 'Email providers (Gmail / Outlook)', module: 'M3/M14', level: 'adapter-verified', note: 'Represented; adapter-verified until configured.' },
  { capability: 'Calendar providers (Google / M365)', module: 'M8', level: 'adapter-verified', note: 'Represented; adapter-verified until configured.' },
  { capability: 'Video / meeting providers (Zoom / Teams / Meet)', module: 'M10', level: 'adapter-verified', note: 'Meeting record is in-process; A/V delivery is adapter-verified until configured.' },
  { capability: 'Cloud storage providers (Drive / OneDrive / Dropbox)', module: 'M12', level: 'adapter-verified', note: 'File bytes; adapter-verified until configured.' },
  { capability: 'Messaging provider (Slack)', module: 'M9', level: 'adapter-verified', note: 'Represented; adapter-verified until configured.' },
  { capability: 'Desktop (Electron) / mobile capabilities', module: 'M21/M22', level: 'adapter-verified', note: 'Multi-window/offline/push/camera/biometrics represented until packaged/built.' },
  // Business-data-pending — real content; registries start empty
  { capability: 'Real documents', module: 'M4', level: 'business-data-pending', note: 'Empty until real documents are authored.' },
  { capability: 'Real chats', module: 'M9', level: 'business-data-pending', note: 'Empty until real messages are sent.' },
  { capability: 'Real meetings', module: 'M10', level: 'business-data-pending', note: 'Empty until real meetings are scheduled.' },
  { capability: 'Real notes', module: 'M6', level: 'business-data-pending', note: 'Empty until real notes are written.' },
  { capability: 'Real knowledge', module: 'M5', level: 'business-data-pending', note: 'Empty until real articles are published.' },
  { capability: 'Real files', module: 'M12', level: 'business-data-pending', note: 'Empty until real files are added.' },
  // Regulated-external — regulated infrastructure / authority; never executed
  { capability: 'Legal retention', module: 'M4/M12', level: 'regulated-external', note: 'Requires a regulated retention/e-discovery system. Represented, never enforced.' },
  { capability: 'Government archiving', module: 'M4', level: 'regulated-external', note: 'Requires a government archive. Represented, never performed.' },
  { capability: 'Compliance exports', module: 'M17', level: 'regulated-external', note: 'Requires a regulated export pipeline. Represented, never executed.' },
  { capability: 'Real email hosting', module: 'M3', level: 'regulated-external', note: 'Requires real mail infrastructure. Never operated.' },
  { capability: 'Real video conferencing infrastructure', module: 'M10', level: 'regulated-external', note: 'Requires real A/V infrastructure. Never operated.' },
  { capability: 'Public cloud storage / messaging', module: 'M12/M9', level: 'regulated-external', note: 'Requires real public services. Never operated.' },
];

export interface WorkspaceReadiness {
  total: number;
  liveVerified: number;
  adapterVerified: number;
  businessDataPending: number;
  regulatedExternal: number;
}

export function workspaceReadiness(matrix: CapabilityEvidence[] = WORKSPACE_MATRIX): WorkspaceReadiness {
  const by = (l: EvidenceLevel): number => matrix.filter((m) => m.level === l).length;
  return {
    total: matrix.length,
    liveVerified: by('live-verified'),
    adapterVerified: by('adapter-verified'),
    businessDataPending: by('business-data-pending'),
    regulatedExternal: by('regulated-external'),
  };
}
