/**
 * Renderer UI verification harness.
 *
 * The renderer's `lib/ipc.ts` binds `window.neuropause.invoke` at MODULE LOAD,
 * so the bridge has to exist before any import of it. This file is a vitest
 * `setupFiles` entry, which runs first.
 *
 * The bridge here is not a mock of behaviour: it dispatches to the REAL main
 * process handlers (`initDecisions`, `experienceProfileService`) over real
 * temp files, through the real Zod schemas. What is stubbed is only Electron's
 * message transport — everything the screens actually depend on is genuine.
 */
import { vi } from 'vitest';

type Handler = (payload: unknown) => unknown;
const routes = new Map<string, Handler>();

export function route(channel: string, handler: Handler): void {
  routes.set(channel, handler);
}
export function clearRoutes(): void {
  routes.clear();
  unrouted.length = 0;
}

/**
 * Channels a component asked for that no test routed.
 *
 * This exists because of a real bug in these very tests: the first-run harness
 * routed `ai:config.detectOllama`, but the channel is actually
 * `aiConfig:detectOllama`. The component catches the rejection and falls back
 * to "no local model reachable" — which is exactly what the test then
 * asserted. It passed, while verifying nothing.
 *
 * Recording the misses lets a test say "and nothing went unrouted", turning a
 * silent false-pass into a failure.
 */
const unrouted: string[] = [];
export function unroutedChannels(): string[] {
  return [...new Set(unrouted)];
}

const bridge = {
  invoke: async (channel: string, payload?: unknown): Promise<unknown> => {
    const handler = routes.get(channel);
    if (!handler) {
      unrouted.push(channel);
      throw new Error(`UNROUTED_CHANNEL:${channel}`);
    }
    return handler(payload ?? {});
  },
  on: () => () => undefined,
  send: () => undefined,
};

Object.defineProperty(globalThis, 'window', { value: globalThis.window ?? {}, writable: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis.window as any).neuropause = bridge;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).neuropause = bridge;

// framer-motion's animation loop is not what we are verifying, so `motion.x`
// becomes a plain element.
//
// The components MUST be cached per tag. A Proxy that builds a fresh function
// on every property access hands React a new element *type* on every render,
// so React unmounts and remounts the whole subtree each time — which silently
// discards the effects of the state update that caused the render, and makes
// every click look like it did nothing.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const cache = new Map<string, React.FC<Record<string, unknown>>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motion = new Proxy({} as any, {
    get: (_target, tag: string) => {
      if (!cache.has(tag)) {
        // Motion-only props would land on the DOM node and trigger React
        // "unknown prop" warnings, so they are stripped here.
        const Component: React.FC<Record<string, unknown>> = ({ children, ...props }) => {
          const {
            initial: _i, animate: _a, exit: _e, transition: _t, variants: _v,
            whileHover: _wh, whileTap: _wt, layout: _l, layoutId: _li,
            ...domProps
          } = props as Record<string, unknown>;
          return React.createElement(tag, domProps, children as React.ReactNode);
        };
        Component.displayName = `motion.${tag}`;
        cache.set(tag, Component);
      }
      return cache.get(tag);
    },
  });
  return {
    motion,
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
  };
});
