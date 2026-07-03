import { AnimatePresence } from 'framer-motion';
import { StoreProvider, useStore } from './StoreProvider';
import { MarketplaceHome } from './MarketplaceHome';
import { AppDetail } from './AppDetail';
import { InstallFlow } from './InstallFlow';

/**
 * Root of the AI Store experience. Holds the store's own navigation (home ↔
 * app detail) inside the shell's "store" section — no global route needed — and
 * mounts the install flow as a modal above whichever surface is showing.
 */
function StoreRouter(): JSX.Element {
  const { route, installing, endInstall, refreshInstalls, launch } = useStore();

  return (
    <div className="h-full">
      {route.name === 'home' ? <MarketplaceHome /> : <AppDetail slug={route.slug} />}

      <AnimatePresence>
        {installing && (
          <InstallFlow
            key={installing.slug}
            app={installing}
            onClose={endInstall}
            onInstalled={() => void refreshInstalls()}
            onLaunch={() => {
              launch(installing.slug, installing.name);
              endInstall();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function StoreApp(): JSX.Element {
  return (
    <StoreProvider>
      <StoreRouter />
    </StoreProvider>
  );
}
