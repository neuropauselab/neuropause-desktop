/**
 * FG-9 · S5.2 · the certified Proposal's EIGHT review fields, rendered VERBATIM for the ASK/confirm surface.
 *
 * DISPLAY-ONLY DATA: no callable, no `confirmed` flag, no authority material. The renderer renders the strings
 * it is given and NEVER re-derives or synthesizes a field — the main handler projects the certified Proposal
 * artifact into these fields verbatim. The confirm action still flows ONLY through the existing
 * confirm → CST → admission path; this card is a truthful surface, not a control.
 *
 * ADDITIVE-ONLY FALLBACK: absent `review` ⇒ this renders nothing, so the propose/confirm panel behaves exactly
 * as it does today (the FG-9 field is additive-optional).
 */
export interface BrainReview {
  readonly purpose: string;
  readonly target: string;
  readonly action: string;
  readonly risk: string;
  readonly evidenceRefs: readonly string[];
  readonly expectedEffect: string;
  readonly verificationPlan: string;
  readonly expiry: string;
}

export function BrainReviewCard({ review }: { review: BrainReview | null | undefined }): JSX.Element | null {
  if (review == null) return null; // additive-only fallback — panel behaves exactly as today
  const rows: ReadonlyArray<readonly [string, string]> = [
    ['Purpose', review.purpose],
    ['Target', review.target],
    ['Action', review.action],
    ['Risk', review.risk],
    ['Evidence', review.evidenceRefs.join(', ')],
    ['Expected effect', review.expectedEffect],
    ['Verification', review.verificationPlan],
    ['Expires', review.expiry],
  ];
  return (
    <div aria-label="Proposal review" className="rounded-xl border border-[var(--hairline)] p-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} data-review-field={label} className="flex justify-between gap-3 py-0.5">
          <span className="text-faint">{label}</span>
          <span className="text-ink">{value}</span>
        </div>
      ))}
    </div>
  );
}
