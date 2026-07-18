import { StoreApp } from '@renderer/store/StoreApp';

/**
 * The AI Store section. Phase 3 replaces the earlier catalog grid with the full
 * marketplace experience (premium home, app detail pages, and a visual install
 * flow) implemented under `renderer/src/store`. This thin wrapper preserves the
 * `StoreView` export the shell lazy-loads.
 */
export function StoreView(): JSX.Element {
  return <StoreApp />;
}
