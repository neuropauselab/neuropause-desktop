/**
 * React Native transport (Mobile M1-08) — the HTTP side of the sealed channel
 * (POST /pair, POST /rpc) plus a helper to open the realtime WS. Carries only
 * ciphertext; the sealing/opening happens in the pure client (sealedClient.ts).
 */
import type { SealedEnvelope } from '@neuropause/companion-protocol';
import type { CompanionTransport } from './sealedClient';

const REQUEST_TIMEOUT_MS = 12_000;

async function postJson(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** The HTTP transport the CompanionClient uses. */
export const httpTransport: CompanionTransport = {
  async postSealed(host, port, path, envelope) {
    const res = await postJson(`http://${host}:${port}${path}`, envelope);
    if (res.status !== 200) return null;
    return (await res.json()) as SealedEnvelope;
  },
};

/**
 * Open the realtime event WebSocket and send the sealed hello. The caller
 * supplies the sealed hello frame and a handler for incoming sealed frames.
 */
export function openEventSocket(input: {
  host: string;
  port: number;
  sealedHello: SealedEnvelope;
  onFrame: (frame: SealedEnvelope) => void;
  onClose?: (code: number) => void;
}): WebSocket {
  const ws = new WebSocket(`ws://${input.host}:${input.port}/events`);
  ws.onopen = () => ws.send(JSON.stringify(input.sealedHello));
  ws.onmessage = (evt: MessageEvent) => {
    try {
      input.onFrame(JSON.parse(String(evt.data)) as SealedEnvelope);
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = (evt: CloseEvent) => input.onClose?.(evt.code);
  return ws;
}
