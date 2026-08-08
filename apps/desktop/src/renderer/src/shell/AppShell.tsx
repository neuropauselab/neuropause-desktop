import { lazy, Suspense, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@neuropause/shared';
import { useShell } from '@renderer/state/ShellProvider';
import { useScale } from '@renderer/state/ScaleProvider';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { WorkspaceErrorBoundary } from '@renderer/components/WorkspaceErrorBoundary';
import { Spinner } from '@renderer/components/Spinner';
import { ipc } from '@renderer/lib/ipc';
import { createLogger } from '@renderer/lib/logger';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { VoiceWidget } from '../voice/VoiceWidget';
import { PerformanceOverlay } from './PerformanceOverlay';
import { PerfSampler } from '@renderer/state/PerfSampler';
import { HomeView } from '@renderer/views/HomeView';
import { OnboardingWizard } from '@renderer/onboarding/OnboardingWizard';
import { SECTIONS, type SectionId } from './sections';
import { PreviewBanner } from './PreviewBanner';

const log = createLogger('shell');

// Heavy / non-landing views are code-split so the initial bundle stays small
// and cold start is fast. (HomeView predates the split and stays eager; the
// landing surface is Mission Control — see startupPolicy.ts, Phase 6 Stage 2.)
const WelcomeView = lazy(() =>
  import('@renderer/views/WelcomeView').then((m) => ({ default: m.WelcomeView })),
);
const StoreView = lazy(() =>
  import('@renderer/views/StoreView').then((m) => ({ default: m.StoreView })),
);
const WorkspaceView = lazy(() =>
  import('@renderer/views/WorkspaceView').then((m) => ({ default: m.WorkspaceView })),
);
const OperationsView = lazy(() =>
  import('@renderer/views/OperationsView').then((m) => ({ default: m.OperationsView })),
);
const ConnectorsView = lazy(() =>
  import('@renderer/views/ConnectorsView').then((m) => ({ default: m.ConnectorsView })),
);
const MemoryView = lazy(() =>
  import('@renderer/views/MemoryView').then((m) => ({ default: m.MemoryView })),
);
const WorkforceView = lazy(() =>
  import('@renderer/views/WorkforceView').then((m) => ({ default: m.WorkforceView })),
);
const WorkforceCenterView = lazy(() =>
  import('@renderer/workforceCenter/WorkforceCenterView').then((m) => ({ default: m.WorkforceCenterView })),
);
const MarketplaceView = lazy(() =>
  import('@renderer/marketplace/MarketplaceView').then((m) => ({ default: m.MarketplaceView })),
);
const FederationCenterView = lazy(() =>
  import('@renderer/federationCenter/FederationCenterView').then((m) => ({ default: m.FederationCenterView })),
);
const ControlPlaneView = lazy(() =>
  import('@renderer/controlPlane/ControlPlaneView').then((m) => ({ default: m.ControlPlaneView })),
);
const DeveloperCenterView = lazy(() =>
  import('@renderer/developerCenter/DeveloperCenterView').then((m) => ({ default: m.DeveloperCenterView })),
);
const IndustryCenterView = lazy(() =>
  import('@renderer/industryCenter/IndustryCenterView').then((m) => ({ default: m.IndustryCenterView })),
);
const StrategyCenterView = lazy(() =>
  import('@renderer/strategyCenter/StrategyCenterView').then((m) => ({ default: m.StrategyCenterView })),
);
const TwinCenterView = lazy(() =>
  import('@renderer/twinCenter/TwinCenterView').then((m) => ({ default: m.TwinCenterView })),
);
const KnowledgeCenterView = lazy(() =>
  import('@renderer/knowledgeCenter/KnowledgeCenterView').then((m) => ({ default: m.KnowledgeCenterView })),
);
const OrchestrationCenterView = lazy(() =>
  import('@renderer/orchestrationCenter/OrchestrationCenterView').then((m) => ({ default: m.OrchestrationCenterView })),
);
const NetworkCenterView = lazy(() =>
  import('@renderer/networkCenter/NetworkCenterView').then((m) => ({ default: m.NetworkCenterView })),
);
const AutoOpsCenterView = lazy(() =>
  import('@renderer/autonomousOpsCenter/AutoOpsCenterView').then((m) => ({ default: m.AutoOpsCenterView })),
);
const CommercialCenterView = lazy(() =>
  import('@renderer/commercialCenter/CommercialCenterView').then((m) => ({ default: m.CommercialCenterView })),
);
const DecisionCenterView = lazy(() =>
  import('@renderer/decisionCenter/DecisionCenterView').then((m) => ({ default: m.DecisionCenterView })),
);
const IntentHomeView = lazy(() =>
  import('@renderer/intentHome/IntentHomeView').then((m) => ({ default: m.IntentHomeView })),
);
// Phase 6 Stage 2 — Mission Control, the live landing dashboard. Lazy like the
// other landing surfaces so the initial bundle stays small.
const MissionControlHost = lazy(() =>
  import('@renderer/missionControl/MissionControlHost').then((m) => ({ default: m.MissionControlHost })),
);
// Phase 6 Stage 3 — Universal Search over every existing index (additive).
const SearchHost = lazy(() =>
  import('@renderer/search/SearchHost').then((m) => ({ default: m.SearchHost })),
);
// Phase 6 Stage 4 — the Workspace Assistant (additive).
const AssistantHost = lazy(() =>
  import('@renderer/assistant/AssistantHost').then((m) => ({ default: m.AssistantHost })),
);
// Phase 6 Stage 5 — the Work Hub: the personal workday surface (additive).
const HubHost = lazy(() => import('@renderer/hub/HubHost').then((m) => ({ default: m.HubHost })));
const EnterpriseView = lazy(() =>
  import('@renderer/views/EnterpriseView').then((m) => ({ default: m.EnterpriseView })),
);
const BusinessView = lazy(() =>
  import('@renderer/business/BusinessView').then((m) => ({ default: m.BusinessView })),
);
const ProductOpsView = lazy(() =>
  import('@renderer/productOps/ProductOpsView').then((m) => ({ default: m.ProductOpsView })),
);
const AdministrationView = lazy(() =>
  import('@renderer/administration/AdministrationView').then((m) => ({ default: m.AdministrationView })),
);
const IntelligenceView = lazy(() =>
  import('@renderer/intelligence/IntelligenceView').then((m) => ({ default: m.IntelligenceView })),
);
const CollaborationView = lazy(() =>
  import('@renderer/collaboration/CollaborationView').then((m) => ({ default: m.CollaborationView })),
);
const KnowledgeWorkspaceView = lazy(() =>
  import('@renderer/knowledge2/KnowledgeWorkspaceView').then((m) => ({ default: m.KnowledgeWorkspaceView })),
);
const AutomationCenterView = lazy(() =>
  import('@renderer/automationCenter/AutomationCenterView').then((m) => ({ default: m.AutomationCenterView })),
);
const AiOperationsView = lazy(() =>
  import('@renderer/aiOperations/AiOperationsView').then((m) => ({ default: m.AiOperationsView })),
);
const PlatformEcosystemView = lazy(() =>
  import('@renderer/platformEcosystem/PlatformEcosystemView').then((m) => ({ default: m.PlatformEcosystemView })),
);
const OpsCenterView = lazy(() =>
  import('@renderer/views/OpsCenterView').then((m) => ({ default: m.OpsCenterView })),
);
const DeveloperView = lazy(() =>
  import('@renderer/views/DeveloperView').then((m) => ({ default: m.DeveloperView })),
);
const EcosystemView = lazy(() =>
  import('@renderer/views/EcosystemView').then((m) => ({ default: m.EcosystemView })),
);
const CloudView = lazy(() =>
  import('@renderer/views/CloudView').then((m) => ({ default: m.CloudView })),
);
const InfrastructureView = lazy(() =>
  import('@renderer/views/InfrastructureView').then((m) => ({ default: m.InfrastructureView })),
);
const OrganizationView = lazy(() =>
  import('@renderer/views/OrganizationView').then((m) => ({ default: m.OrganizationView })),
);
const FederationView = lazy(() =>
  import('@renderer/views/FederationView').then((m) => ({ default: m.FederationView })),
);
const NotificationsView = lazy(() =>
  import('@renderer/views/NotificationsView').then((m) => ({ default: m.NotificationsView })),
);
const SettingsShell = lazy(() =>
  import('@renderer/settings/SettingsShell').then((m) => ({ default: m.SettingsShell })),
);
const SandboxView = lazy(() =>
  import('@renderer/views/SandboxView').then((m) => ({ default: m.SandboxView })),
);

function ViewFallback(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

/**
 * The authenticated application shell: full-width toolbar, resizable sidebar,
 * an animated content region that lazy-loads each section behind an error
 * boundary, and the command palette. Global keyboard shortcuts are delivered by
 * the native menu (see main/menu.ts) and handled here.
 */
export function AppShell({ session }: { session: Session }): JSX.Element {
  const {
    activeSection,
    commandOpen,
    activeTabId,
    setCommandOpen,
    setSection,
    requestNewTab,
    closeActiveTab,
  } = useShell();
  const { zoomIn, zoomOut, reset } = useScale();

  // Live refs so the once-subscribed menu handler always sees current values.
  const openRef = useRef(commandOpen);
  openRef.current = commandOpen;
  // Navigate straight to a section by id (used by in-renderer CTAs and onboarding).
  const goToSection = (id: SectionId): void => {
    setSection(id);
  };

  const sectionRef = useRef(activeSection);
  sectionRef.current = activeSection;
  const activeTabRef = useRef(activeTabId);
  activeTabRef.current = activeTabId;

  useEffect(() => {
    const off = ipc.menu.onCommand((cmd) => {
      switch (cmd.action) {
        case 'command-palette':
          setCommandOpen(!openRef.current);
          break;
        case 'open-settings':
          setSection('settings');
          break;
        case 'navigate-section':
          // Navigate by section id (from the tray). Only honor a real, visible section — never a hidden one.
          if (cmd.section && SECTIONS.some((s) => s.id === cmd.section && !s.hidden)) {
            setSection(cmd.section as SectionId);
          }
          break;
        case 'new-tab':
          requestNewTab();
          break;
        case 'close-tab':
          // Close the active workspace tab when viewing the Workspace; otherwise
          // fall back to the conventional "close window".
          if (sectionRef.current === 'workspace' && activeTabRef.current) {
            closeActiveTab();
          } else {
            void ipc.app.closeWindow();
          }
          break;
        case 'zoom-in':
          zoomIn();
          break;
        case 'zoom-out':
          zoomOut();
          break;
        case 'zoom-reset':
          reset();
          break;
        default:
          log.warn('Unhandled menu command', cmd);
      }
    });
    return off;
  }, [
    setCommandOpen,
    setSection,
    requestNewTab,
    closeActiveTab,
    zoomIn,
    zoomOut,
    reset,
  ]);

  const renderView = (): JSX.Element => {
    switch (activeSection) {
      case 'mission-control':
        return <MissionControlHost onNavigate={(id) => goToSection(id)} />;
      case 'search':
        return <SearchHost onNavigate={(id) => goToSection(id)} />;
      case 'assistant':
        return <AssistantHost onNavigate={(id) => goToSection(id)} />;
      case 'hub':
        return <HubHost onNavigate={(id) => goToSection(id)} />;
      case 'intent-home':
        return <IntentHomeView onOpenSection={(id) => goToSection(id as SectionId)} />;
      case 'decision-center':
        return <DecisionCenterView onOpenSection={(id) => goToSection(id as SectionId)} />;
      case 'home':
        return <HomeView session={session} />;
      case 'welcome':
        return <WelcomeView />;
      case 'organization':
        return <OrganizationView />;
      case 'store':
        return <StoreView />;
      case 'workspace':
        return <WorkspaceView />;
      case 'operations':
        return <OperationsView />;
      case 'connectors':
        return <ConnectorsView />;
      case 'memory':
        return <MemoryView />;
      case 'enterprise':
        return <EnterpriseView />;
      case 'business':
        return <BusinessView />;
      case 'product-ops':
        return <ProductOpsView onOpenSection={(id) => goToSection(id as SectionId)} />;
      case 'administration':
        return <AdministrationView />;
      case 'intelligence':
        return <IntelligenceView />;
      case 'collaboration':
        return <CollaborationView />;
      case 'knowledge':
        return <KnowledgeWorkspaceView />;
      case 'automation-center':
        return <AutomationCenterView />;
      case 'ai-operations':
        return <AiOperationsView />;
      case 'extensibility':
        return <PlatformEcosystemView />;
      case 'opscenter':
        return <OpsCenterView />;
      case 'developer':
        return <DeveloperView />;
      case 'ecosystem':
        return <EcosystemView />;
      case 'cloud':
        return <CloudView />;
      case 'infrastructure':
        return <InfrastructureView />;
      case 'federation':
        return <FederationView />;
      case 'workforce':
        return <WorkforceView />;
      case 'workforce-center':
        return <WorkforceCenterView />;
      case 'marketplace':
        return <MarketplaceView />;
      case 'federation-center':
        return <FederationCenterView />;
      case 'control-plane':
        return <ControlPlaneView />;
      case 'developer-center':
        return <DeveloperCenterView />;
      case 'industry-center':
        return <IndustryCenterView />;
      case 'strategy-center':
        return <StrategyCenterView />;
      case 'twin-center':
        return <TwinCenterView />;
      case 'knowledge-center':
        return <KnowledgeCenterView />;
      case 'orchestration-center':
        return <OrchestrationCenterView />;
      case 'network-center':
        return <NetworkCenterView />;
      case 'auto-ops-center':
        return <AutoOpsCenterView />;
      case 'commercial-center':
        return <CommercialCenterView />;
      case 'automations':
        return <WorkforceView initialTab="studio" />;
      case 'notifications':
        return <NotificationsView />;
      case 'analytics':
        return <WorkforceView initialTab="analytics" />;
      case 'sandbox':
        return <SandboxView />;
      case 'settings':
        return <SettingsShell session={session} onOpenSection={(id) => goToSection(id as SectionId)} />;
      default:
        return <HomeView session={session} />;
    }
  };

  // RC Phase 1 (P4) — surface the registry's `preview` flag in-view, so entering a
  // preview section by deep-link/command-palette (which bypasses the sidebar chip)
  // still shows the honest preview context.
  const activeMeta = SECTIONS.find((s) => s.id === activeSection);

  // Phase 2 (IA) — reflect the active section in the window/document title so the OS
  // window chrome matches the sidebar and page heading. Single source of truth: the
  // section registry label; no breadcrumb system, no duplicate page-title chrome.
  useEffect(() => {
    const meta = SECTIONS.find((s) => s.id === activeSection);
    document.title = meta?.label ? `NeuroPause — ${meta.label}` : 'NeuroPause';
  }, [activeSection]);

  return (
    <div className="app-bg flex h-full w-full flex-col text-ink">
      <Toolbar session={session} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex h-full flex-col"
            >
              {activeMeta?.preview && (
                <PreviewBanner label={activeMeta.label} />
              )}
              <div className="min-h-0 flex-1">
                <WorkspaceErrorBoundary name={activeSection}>
                  <Suspense fallback={<ViewFallback />}>{renderView()}</Suspense>
                </WorkspaceErrorBoundary>
              </div>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <ErrorBoundary inline name="command-palette">
        <CommandPalette />
      </ErrorBoundary>
      <ErrorBoundary inline name="voice-assistant">
        <VoiceWidget />
      </ErrorBoundary>
      <ErrorBoundary inline name="onboarding">
        <OnboardingWizard onGoTo={goToSection} />
      </ErrorBoundary>
      {/* Always-mounted invisible runtime performance collector (feeds Diagnostics + the dev overlay). */}
      <ErrorBoundary inline name="perf-sampler">
        <PerfSampler />
      </ErrorBoundary>
      {/* Developer-only performance HUD; renders null on packaged builds. */}
      <ErrorBoundary inline name="perf-overlay">
        <PerformanceOverlay />
      </ErrorBoundary>
    </div>
  );
}
