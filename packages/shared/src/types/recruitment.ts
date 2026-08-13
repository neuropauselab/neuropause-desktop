/**
 * HR → Recruitment — the pure candidate-pipeline engine (Final Wave FW-10).
 *
 * A candidate is one person's application for one position, moving through a
 * FIXED, human-driven pipeline:
 *
 *   applied → screening → interview → offer → hired
 *        └──────┴────────────┴─────────┴──→ rejected  (any live stage)
 *
 * ADVANCE moves exactly one step along the happy path; REJECT ends any live
 * application; HIRE is only legal from `offer` and is the integration seam —
 * it creates a REAL Employee record through the Employees module's own
 * validate hook (guards, org rules, everything), with the next free
 * EMP-<n> number derived deterministically from the numbers that exist.
 * Hired and rejected applications are decided history — immutable.
 *
 * Pure (no I/O) so the module hooks and tests share it.
 */

export const CANDIDATES_MODULE_ID = 'hr-candidates';
export const CANDIDATE_KIND = 'candidate';

/** The pipeline stages, in happy-path order (+ the two terminal decisions). */
export const RECRUITMENT_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
export type RecruitmentStage = (typeof RECRUITMENT_STAGES)[number];

/** Stages an application can still move out of. */
export const LIVE_RECRUITMENT_STAGES = ['applied', 'screening', 'interview', 'offer'] as const;

/** The single next happy-path stage, or null at the end of the path. */
export function nextRecruitmentStage(stage: string): RecruitmentStage | null {
  switch (stage) {
    case 'applied':
      return 'screening';
    case 'screening':
      return 'interview';
    case 'interview':
      return 'offer';
    default:
      return null; // offer advances only through HIRE; terminals never advance
  }
}

/** True when the stage is live (not yet hired/rejected). */
export function isLiveRecruitmentStage(stage: string): boolean {
  return (LIVE_RECRUITMENT_STAGES as readonly string[]).includes(stage);
}

/**
 * The next free EMP-<n> employee number, given every existing number:
 * one past the highest EMP-<digits> seen, zero-padded to 4 (EMP-0001, …).
 * Non-conforming numbers are ignored — the sequence only ever moves forward.
 */
export function nextEmployeeNumber(existingNumbers: ReadonlyArray<string>): string {
  let highest = 0;
  for (const number of existingNumbers) {
    const m = /^EMP-(\d+)$/.exec(number.trim());
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > highest) highest = n;
  }
  return `EMP-${String(highest + 1).padStart(4, '0')}`;
}
