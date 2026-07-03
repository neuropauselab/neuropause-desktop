import type { IpcChannelName } from '@neuropause/shared';

/** The shape exposed on window.neuropause by the preload bridge. */
export interface NeuroPauseBridge {
  invoke(channel: IpcChannelName, payload?: unknown): Promise<unknown>;
  subscribe(channel: IpcChannelName, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    neuropause: NeuroPauseBridge;
  }
}
