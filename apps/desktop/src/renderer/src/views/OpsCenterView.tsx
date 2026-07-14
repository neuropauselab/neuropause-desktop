import { OpsCenterRoot } from '@renderer/operationsCenter/OpsCenterView';

/**
 * P7.1 — the Enterprise Operations Center. A world-class desktop command center
 * over the completed P7 Enterprise Intelligence Platform: one unified report
 * (health · risk · dependencies · capacity · incidents · recommendations) plus
 * the two targeted analyses (change-impact · root-cause), rendered across ~14
 * screens. PURE UI — every byte of data comes from the existing P7 read-only IPC
 * (`ipc.enterpriseIntel.*`) and existing surfaces (search · timeline). This
 * wrapper preserves the export the shell lazy-loads.
 */
export function OpsCenterView(): JSX.Element {
  return <OpsCenterRoot />;
}
