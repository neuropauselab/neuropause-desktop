/**
 * Preload bridge. This is the entire surface the renderer can touch. It runs in
 * an isolated, sandboxed context and exposes exactly two functions — a guarded
 * request/response `invoke` and a guarded broadcast `subscribe`. Channels are
 * checked against the shared allowlists so the renderer can never reach an
 * unintended channel, and no Node or Electron internals leak through.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  ALL_INVOKABLE_CHANNELS,
  ALL_SUBSCRIBABLE_CHANNELS,
  type IpcChannelName,
} from '@neuropause/shared';

const bridge = {
  invoke(channel: IpcChannelName, payload?: unknown): Promise<unknown> {
    if (!ALL_INVOKABLE_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`Channel "${channel}" is not invokable`));
    }
    return ipcRenderer.invoke(channel, payload);
  },

  subscribe(channel: IpcChannelName, listener: (payload: unknown) => void): () => void {
    if (!ALL_SUBSCRIBABLE_CHANNELS.includes(channel)) {
      throw new Error(`Channel "${channel}" is not subscribable`);
    }
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    // Return an unsubscribe handle so React effects can clean up.
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('neuropause', bridge);

export type NeuroPauseBridge = typeof bridge;
