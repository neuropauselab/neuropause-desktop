#!/usr/bin/env node
/**
 * Live backend journey — HTTP measurements against a RUNNING NeuroPause backend.
 *
 *   node live-backend-journey.cjs --base http://127.0.0.1:4010 --out <dir> [--ollama http://127.0.0.1:11434]
 *
 * Measures, in order, with a throwaway user (email carries a nonce; nothing is
 * reused): health · registration · login · /me · refresh rotation · refresh REUSE
 * detection (chain burn) · logout · organization create · device register ·
 * heartbeat · revoke · heartbeat-after-revoke (expect 403 device_revoked) ·
 * re-register-after-revoke (expect 403) · AI gateway status · AI gateway chat
 * (expects 503 ai_unavailable when unconfigured, 200 with AI_PROPOSES_ONLY when
 * configured) · AI gateway without bearer (expect 401). Every step records the
 * HTTP status, a redacted body excerpt, and PASS/FAIL against the expectation.
 * Writes <out>/live-backend-journey.json. Exit 1 on any FAIL.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function arg(n, d = null) { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; }
const BASE = arg('base', 'http://127.0.0.1:4010').replace(/\/+$/, '');
const OUT = path.resolve(arg('out', '.'));
fs.mkdirSync(OUT, { recursive: true });
const steps = [];
const redact = (o) => JSON.stringify(o, (k, v) => (/token|password|secret/i.test(k) && typeof v === 'string' ? `<redacted:${v.length}>` : v)).slice(0, 400);

async function call(name, method, p, { body, token, expect: exp } = {}) {
  const started = Date.now();
  let status = 0, json = null, text = '';
  try {
    const res = await fetch(`${BASE}${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    status = res.status; text = await res.text();
    try { json = JSON.parse(text); } catch { json = null; }
  } catch (e) { text = String(e.message); }
  const ok = typeof exp === 'function' ? exp(status, json) : Array.isArray(exp) ? exp.includes(status) : status === exp;
  steps.push({ step: name, method, path: p, status, ok, ms: Date.now() - started, body_excerpt: json ? redact(json) : text.slice(0, 200), expected: typeof exp === 'function' ? 'predicate' : exp });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${method} ${p} → ${status}`);
  return { status, json };
}

(async () => {
  const nonce = randomUUID().slice(0, 8);
  const email = `np-launch-${nonce}@example.test`;
  const password = `Np!${randomUUID()}`;
  await call('health', 'GET', '/health', { expect: (s, j) => s === 200 && j && j.status === 'ok' });
  await call('auth providers list', 'GET', '/auth/providers', { expect: 200 });
  const reg = await call('email registration', 'POST', '/auth/email/register', { body: { email, password, displayName: 'Launch Probe' }, expect: [200, 201] });
  let access = reg.json?.tokens?.accessToken, refresh = reg.json?.tokens?.refreshToken;
  const login = await call('email login', 'POST', '/auth/email/login', { body: { email, password }, expect: 200 });
  access = login.json?.tokens?.accessToken ?? access; refresh = login.json?.tokens?.refreshToken ?? refresh;
  await call('wrong password rejected', 'POST', '/auth/email/login', { body: { email, password: 'wrong-password-123' }, expect: 401 });
  await call('/me with bearer', 'GET', '/auth/me', { token: access, expect: (s, j) => s === 200 && j && j.user && j.user.email === email });
  await call('/me without bearer', 'GET', '/auth/me', { expect: 401 });
  const rot = await call('refresh rotation', 'POST', '/auth/token/refresh', { body: { refreshToken: refresh }, expect: 200 });
  const refresh2 = rot.json?.tokens?.refreshToken ?? rot.json?.refreshToken;
  await call('refresh REUSE of rotated token detected (chain burn)', 'POST', '/auth/token/refresh', { body: { refreshToken: refresh }, expect: 401 });
  await call('rotated chain is burned (new token also refused)', 'POST', '/auth/token/refresh', { body: { refreshToken: refresh2 }, expect: 401 });
  const login2 = await call('re-login after chain burn', 'POST', '/auth/email/login', { body: { email, password }, expect: 200 });
  const r3 = login2.json?.tokens?.refreshToken;
  await call('logout', 'POST', '/auth/logout', { body: { refreshToken: r3 }, expect: [200, 204] });
  await call('refresh after logout refused', 'POST', '/auth/token/refresh', { body: { refreshToken: r3 }, expect: 401 });
  const login3 = await call('login for device journey', 'POST', '/auth/email/login', { body: { email, password }, expect: 200 });
  const tok = login3.json?.tokens?.accessToken;
  const org = await call('organization create', 'POST', '/organizations', { token: tok, body: { name: `Launch Org ${nonce}` }, expect: [200, 201] });
  const orgId = org.json?.organization?.id ?? org.json?.org?.id ?? org.json?.id;
  const deviceId = `np-device-${nonce}`;
  const dev = { orgId, deviceId, name: 'Probe Mac', platform: 'desktop', os: 'darwin', arch: 'arm64', appVersion: '1.0.0-rc.30' };
  await call('device register', 'POST', '/devices', { token: tok, body: dev, expect: (s, j) => s === 201 && j && j.device && j.device.trustStatus === 'trusted' });
  await call('device heartbeat', 'POST', `/devices/${deviceId}/heartbeat`, { token: tok, body: { orgId, appVersion: '1.0.0-rc.30' }, expect: 200 });
  await call('device list', 'GET', `/devices?orgId=${orgId}`, { token: tok, expect: [200] });
  await call('device revoke (owner)', 'POST', `/devices/${deviceId}/revoke`, { token: tok, body: { orgId }, expect: (s, j) => s === 200 && j && j.device && j.device.trustStatus === 'revoked' });
  await call('heartbeat AFTER revoke refused (fail closed)', 'POST', `/devices/${deviceId}/heartbeat`, { token: tok, body: { orgId, appVersion: '1.0.0-rc.30' }, expect: (s, j) => s === 403 && j && (j.error === 'device_revoked' || (j.error && j.error.code === 'device_revoked')) });
  await call('re-register AFTER revoke refused (fail closed)', 'POST', '/devices', { token: tok, body: dev, expect: (s, j) => s === 403 && j && (j.error === 'device_revoked' || (j.error && j.error.code === 'device_revoked')) });
  await call('device register without bearer', 'POST', '/devices', { body: dev, expect: 401 });
  const st = await call('AI gateway status', 'GET', '/ai/status', { token: tok, expect: (s, j) => s === 200 && j && j.gateway && j.gateway.policy === 'AI_PROPOSES_ONLY' });
  const configured = !!st.json?.configured;
  await call('AI gateway chat without bearer', 'POST', '/ai/chat', { body: { messages: [{ role: 'user', content: 'hi' }] }, expect: 401 });
  await call(configured ? 'AI gateway chat (live model)' : 'AI gateway chat (unconfigured → 503 fail closed)', 'POST', '/ai/chat', { token: tok, body: { messages: [{ role: 'user', content: 'Reply with the single word PONG.' }], maxOutputTokens: 16 }, expect: configured ? (s, j) => s === 200 && j && j.gateway && j.gateway.grants_authority === false && !('authorized' in j) : (s, j) => s === 503 && j && j.error === 'ai_unavailable' });
  await call('AI gateway bounds (empty messages → 400)', 'POST', '/ai/chat', { token: tok, body: { messages: [] }, expect: 400 });
  const report = { test: 'live-backend-journey', base: BASE, environment_id: arg('env-id', 'local-source-backend'), started_at: new Date().toISOString(), probe_user: `np-launch-${nonce}@example.test (throwaway)`, steps, all_ok: steps.every((s) => s.ok), gateway_configured: configured };
  fs.writeFileSync(path.join(OUT, 'live-backend-journey.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[journey] ${report.all_ok ? 'PASS' : 'FAIL'} (${steps.filter((s) => s.ok).length}/${steps.length}) → ${path.join(OUT, 'live-backend-journey.json')}`);
  process.exit(report.all_ok ? 0 : 1);
})();
