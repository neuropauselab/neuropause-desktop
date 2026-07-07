/**
 * Production binding for the backfill client (V8.2 Part 2 inc3b). Kept apart from
 * backendBackfillClient.ts so the client stays testable. Wires authService token +
 * config.backendUrl + global fetch into a BackfillFn.
 */
import { config } from '../config';
import { authService } from '../auth/authService';
import { createBackendBackfill, type BackfillFn } from './backendBackfillClient';

export const backendBackfill: BackfillFn = createBackendBackfill({
  backendUrl: config.backendUrl,
  getValidAccessToken: () => authService.getValidAccessToken(),
  fetchFn: (url, init) => fetch(url, init),
});
