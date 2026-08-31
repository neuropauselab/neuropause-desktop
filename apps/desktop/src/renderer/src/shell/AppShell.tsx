import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Session } from '@neuropause/shared';
import { useShell } from '@renderer/state/ShellProvider';
import { useScale } from '@renderer/state/ScaleProvider';
import { ErrorBoundary } from '@renderer/components/ErrorBoundary';
import { RuntimeFailureNotice } from './RuntimeFailureNotice';
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
import { FirstRunExperience } from '@renderer/firstRun/FirstRunExperience';
import { setWorkspaceType } from '@renderer/firstRun/workspaceTypeStore';
import { onExperienceProfileChanged } from '@renderer/firstRun/experienceProfileEvents';
import type { ExperienceProfile } from '@neuropause/shared';
import { SECTIONS, type SectionId } from './sections';
import { useIsLocalMode } from './useIsLocalMode';
import { useTenantSwitchEpoch } from './useTenantSwitchEpoch';
import { CloudUnavailableLocal } from './CloudUnavailableLocal';
import { PreviewBanner } from './PreviewBanner';
import { TRANSITION, sectionVariants } from '@renderer/lib/motion';
import { useDelayedFlag } from '@renderer/lib/useDelayedFlag';
import { createScrollMemory, findScroller } from './scrollMemory';

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
// Phase 6 — the Data Command Center (import · review · provenance · quality).
const DataCommandCenterView = lazy(() =>
  import('@renderer/dataCommandCenter/DataCommandCenterView').then((m) => ({
    default: m.DataCommandCenterView,
  })),
);
const MedicalDevicesView = lazy(() =>
  import('@renderer/medicalDevices/MedicalDevicesView').then((m) => ({
    default: m.MedicalDevicesView,
  })),
);
const AiHomeView = lazy(() =>
  import('@renderer/firstRun/AiHomeView').then((m) => ({ default: m.AiHomeView })),
);
const UnderstandView = lazy(() =>
  import('@renderer/understanding/UnderstandView').then((m) => ({ default: m.UnderstandView })),
);
const HoldsView = lazy(() =>
  import('@renderer/understanding/HoldsView').then((m) => ({ default: m.HoldsView })),
);
const OpportunitiesView = lazy(() =>
  import('@renderer/opportunities/OpportunitiesView').then((m) => ({
    default: m.OpportunitiesView,
  })),
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

/**
 * The section-loading fallback.
 *
 * Most lazy chunks resolve inside a couple of frames. Rendering a spinner
 * unconditionally means the common case is a FLASH — a spinner that appears
 * and vanishes before it can be read, which makes a fast app look unstable.
 * So nothing is drawn under the threshold; past it the wait is real and gets
 * acknowledged, fading in rather than snapping.
 *
 * The wrapper keeps `h-full` in both states so the region never collapses and
 * re-expands underneath the content that is about to land.
 */
function ViewFallback(): JSX.Element {
  const show = useDelayedFlag();
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION.quick}
            className="flex flex-col items-center gap-2.5"
          >
            <Spinner />
            <span className="sr-only">Loading this section</span>
          </motion.div>
        )}
      </AnimatePresence>
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
  // S17 — whole-section cloud surfaces show honest absence in local mode.
  const localMode = useIsLocalMode();

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

  // Private-First first-run experience: gate on the persisted profile. While
  // `pending`, the full-screen experience renders INSTEAD of the workspace and
  // the checklist wizard; a completed/skipped profile also feeds the
  // workspace-type nav filter. Null = not yet loaded (render nothing extra).
  // GATE 26 (round 61): increments once per REAL org-workspace switch; keys the
  // view host below so the mounted surface refetches under the new tenant.
  const tenantEpoch = useTenantSwitchEpoch();
  const [experienceProfile, setExperienceProfile] = useState<ExperienceProfile | null>(null);
  // Re-read when the profile is reset from inside the app (Understand →
  // "Answer the setup questions"). Without this the shell keeps the profile it
  // read at mount and the first-run takeover would not reappear until relaunch,
  // making the button look broken.
  const [profileEpoch, setProfileEpoch] = useState(0);
  useEffect(() => onExperienceProfileChanged(() => setProfileEpoch((n) => n + 1)), []);
  /**
   * P13C ROUND 36 — GATE 1. The sticky boot-window race, un-stuck.
   *
   * `xp:profile.get` is a SECURE runtime channel registered at the END of
   * `initRuntimeCore`, while this shell mounts seconds earlier on a restored
   * session. When the invoke raced the registration, the catch below pinned a
   * wrong "skipped" profile for the ENTIRE session — this effect's only
   * re-run trigger was an in-app profile reset. The ref records that the
   * failure happened during the boot window; the runtime-ready broadcast
   * (served by the base router, which cannot race) bumps `profileEpoch` once,
   * re-running this exact effect the moment the channel actually exists.
   */
  const profileLoadRacedBoot = useRef(false);
  // Round 36 — Gate 13: the Sign-In detour. Hides the first-run takeover
  // WITHOUT persisting anything; cleared when the user leaves Settings, at
  // which point the still-pending flow resumes at its persisted step.
  const [signInDetour, setSignInDetour] = useState(false);
  useEffect(() => {
    if (signInDetour && activeSection !== 'settings') setSignInDetour(false);
  }, [signInDetour, activeSection]);
  useEffect(
    () =>
      ipc.runtime.onStateChanged((s) => {
        if (s.state === 'ready' && profileLoadRacedBoot.current) {
          profileLoadRacedBoot.current = false;
          setProfileEpoch((n) => n + 1);
        }
      }),
    [],
  );
  useEffect(() => {
    ipc.firstRun
      .get()
      .then((p) => {
        profileLoadRacedBoot.current = false;
        setExperienceProfile(p);
        setWorkspaceType(p.workspaceType);
      })
      .catch((err: unknown) => {
        // Fail OPEN to the product, never to a stuck takeover: if this channel is
        // unreachable (older main process still running, stale build), treat the
        // profile as already-settled (`skipped`) so the shell renders with NO
        // onboarding surface, rather than trapping the user behind the first-run
        // takeover. The runtime-ready retry above upgrades this from permanent to
        // transient when the cause was the boot window (it re-runs this load).
        profileLoadRacedBoot.current = true;
        // eslint-disable-next-line no-console
        console.warn(
          '[first-run] xp:profile.get failed — showing the shell without onboarding until the runtime reports ready.',
          err,
        );
        setExperienceProfile({
          state: 'skipped',
          workspaceType: null,
          aiModeChosen: false,
          attributes: [],
          completedAt: null,
          updatedAt: null,
        });
      });
  }, [profileEpoch]);

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
        return localMode ? <CloudUnavailableLocal feature="Organization management" /> : <OrganizationView />;
      case 'store':
        return localMode ? <CloudUnavailableLocal feature="The AI Store" /> : <StoreView />;
      case 'workspace':
        return <WorkspaceView />;
      case 'operations':
        return <OperationsView />;
      case 'connectors':
        return <ConnectorsView />;
      case 'data-center':
        return <DataCommandCenterView />;
      case 'medical-devices':
        return <MedicalDevicesView />;
      case 'ai-home':
        return <AiHomeView onNavigate={(id) => goToSection(id)} />;
      case 'understand':
        return <UnderstandView />;
      case 'holds':
        return <HoldsView />;
      case 'opportunities':
        return <OpportunitiesView />;
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

  /**
   * Scroll memory across section changes.
   *
   * Leaving a long list halfway down and coming back to the top is the kind of
   * small, constant cost that makes an app feel like a website. The offset is
   * captured on the way OUT (the section's DOM still exists at that point) and
   * applied on the way IN, after the incoming view has painted — restoring
   * before layout sets `scrollTop` on an element that is still 0px tall, which
   * silently does nothing.
   *
   * `MIN_REMEMBERED_OFFSET` in scrollMemory.ts is what keeps this from becoming
   * the opposite annoyance: a section left at the top restores to the top,
   * because that is not a position worth remembering.
   */
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollMemory = useRef(createScrollMemory());
  const previousSection = useRef<SectionId | null>(null);

  useEffect(() => {
    const host = mainRef.current;
    const leaving = previousSection.current;
    previousSection.current = activeSection;
    if (!host) return;

    if (leaving && leaving !== activeSection) {
      const scroller = findScroller(host);
      if (scroller) scrollMemory.current.remember(leaving, scroller.scrollTop);
    }

    // Two frames: the first lets React commit the new subtree, the second lets
    // the browser lay it out. Restoring inside one of them lands on a zero-
    // height element and is lost.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const scroller = findScroller(mainRef.current);
        if (!scroller) return;
        const target = scrollMemory.current.recall(activeSection);
        // `auto`, never `smooth`: an animated scroll on arrival is motion the
        // user did not ask for, and it fights them if they start scrolling.
        scroller.scrollTo({ top: target, behavior: 'auto' });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [activeSection]);

  return (
    <div className="app-bg flex h-full w-full flex-col text-ink">
      <Toolbar session={session} />
      {/* Round 36 — Gate 1: a failed runtime init is SAID, not silently
          rendered around. Renders nothing on a healthy boot. */}
      <RuntimeFailureNotice />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main ref={mainRef} className="min-w-0 flex-1 overflow-hidden">
          {/*
            `mode="wait"` is deliberate: cross-fading two full sections at once
            double-paints large trees and the overlap reads as a flicker rather
            than a transition. The outgoing view leaves first (fast, on the
            accelerating exit curve), then the incoming one settles.
          */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeSection}
              variants={sectionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex h-full flex-col"
            >
              {activeMeta?.preview && (
                <PreviewBanner label={activeMeta.label} />
              )}
              <div className="min-h-0 flex-1">
                <WorkspaceErrorBoundary name={activeSection}>
                  {/*
                   * GATE 26 (round 61): the view is keyed on the tenant epoch so a
                   * REAL org-workspace switch remounts it and it refetches under the
                   * new tenant. Before this, a switch remounted nothing and mounted
                   * surfaces kept rendering the PREVIOUS tenant's data until the user
                   * navigated — a UI-truth violation, though never a tenancy breach
                   * (the record store re-resolves scope per call and fails closed).
                   * Keyed HERE rather than on ShellProvider so the sidebar, the active
                   * section and shell state all survive the switch: the user stays
                   * where they were and the numbers become true.
                   */}
                  <Suspense fallback={<ViewFallback />}>
                    <Fragment key={`tenant-${tenantEpoch}`}>{renderView()}</Fragment>
                  </Suspense>
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
        {experienceProfile?.state === 'pending' && !signInDetour ? (
          <FirstRunExperience
            profile={experienceProfile}
            onDone={(landing) => {
              ipc.firstRun
                .get()
                .then((p) => {
                  setExperienceProfile(p);
                  setWorkspaceType(p.workspaceType);
                })
                .catch(() => undefined);
              if (landing) goToSection(landing);
            }}
            onSignIn={() => {
              /**
               * P13C ROUND 36 — GATE 13. Sign In is a DETOUR, not a forfeit.
               * This used to write `state: 'skipped'` — a TERMINAL state —
               * so a user who tapped Sign In on the welcome screen lost the
               * AI-routing and workspace questions forever, from a button
               * that promised authentication. The profile now stays pending;
               * the takeover hides for the detour and returns (resuming at
               * the right step) when the user leaves Settings.
               */
              setSignInDetour(true);
              goToSection('settings');
            }}
          />
        ) : null}
        {/*
          GATE 13 (round 58) — ONE onboarding journey. The first-run experience
          above is the single onboarding flow; the separate "Welcome to NeuroPause"
          checklist modal that used to pop the instant first-run finished has been
          removed (it did no setup — a pure tour that duplicated the journey the
          user had just completed). Its checklist content lives on, un-popped, as
          the persistent Getting Started section (WelcomeView), still backed by the
          same `onboarding:*` service.
        */}
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
