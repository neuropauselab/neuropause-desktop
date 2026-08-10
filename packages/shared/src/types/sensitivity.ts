/**
 * Field sensitivity — one classification, shared by every surface that can
 * put a value in front of someone or write it to a file.
 *
 * WHY THIS EXISTS
 *
 * The app had two unrelated field models. The data-plane ontology carried a
 * `sensitive: true` flag, honoured by the import preview, which is why a
 * monthly salary rendered as `••••••••` while a reviewer checked a payroll
 * file. `EnterpriseFieldDef` — the model the EXPORT path reads — had no such
 * flag at all, so the same salary, plus bank account, IFSC, UAN, ESIC and PAN,
 * were written to a spreadsheet in cleartext by a single click.
 *
 * Redacting on one surface and not the other is worse than redacting on
 * neither, because it teaches people the data is handled.
 *
 * HOW IT WORKS
 *
 * Classification is DERIVED, not declared. A module author cannot forget to
 * mark a field: `classifyField` matches the key and the label against a
 * deny-list, and an explicit declaration can only make a field MORE
 * restricted, never less. That direction is the whole design — a list of 106
 * modules maintained by hand will eventually miss one, and the miss is silent.
 *
 * THE THREE CLASSES
 *
 *   secret      Authentication material. Never exported, never previewed,
 *               never logged, with no option to include it. There is no
 *               legitimate reason for an API key to leave in a spreadsheet.
 *   restricted  Personal or financial identifiers — salary, bank account,
 *               government ID. Excluded from exports BY DEFAULT. Includable
 *               only by someone who holds the module's write scope and asks
 *               for it explicitly, and then it is named in the manifest and
 *               the audit line. Payroll administrators do have to produce
 *               payroll files; the requirement is that doing so is a
 *               deliberate, attributable act.
 *   normal      Everything else.
 */

export type SensitivityClass = 'secret' | 'restricted' | 'normal';

/** Ordered least → most restrictive, so two classifications can be combined. */
const RANK: Record<SensitivityClass, number> = { normal: 0, restricted: 1, secret: 2 };

export function moreRestrictive(a: SensitivityClass, b: SensitivityClass): SensitivityClass {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Authentication material.
 *
 * Written against a NORMALIZED string (lower-case, non-alphanumerics
 * collapsed), so `api_key`, `apiKey`, `API Key` and `api-key` are one pattern
 * rather than four that can drift apart.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bpass(word|wd|phrase|code)\b/,
  /\bpwd\b/,
  /\bsecret\b/,
  /\btoken\b/,
  /\bapi\s?key\b/,
  /\baccess\s?key\b/,
  /\bprivate\s?key\b/,
  /\bsigning\s?key\b/,
  /\bssh\s?key\b/,
  /\bencryption\s?key\b/,
  /\bclient\s?secret\b/,
  /\brefresh\s?token\b/,
  /\bsession\s?(id|token)\b/,
  /\bcredential(s)?\b/,
  /\bauth\s?(token|header)\b/,
  /\bconnection\s?string\b/,
  /\bcvv\b/,
  /\botp\b/,
];

/**
 * Personal and financial identifiers.
 *
 * Short tokens are anchored as whole words on purpose. `pan` is an Indian tax
 * identifier and also the first syllable of nothing useful — but `\bpan\b`
 * must not fire on "company" or "panel", which is exactly what an unanchored
 * substring match would do, and an over-broad rule that hides ordinary
 * columns gets switched off by the first person it annoys.
 *
 * The payroll vocabulary here was added after a review found the list caught
 * `netPay` and missed `grossEarnings` on the very same record — one column
 * redacted and the column beside it exported, which is worse than redacting
 * neither. A deny-list is still not a substitute for a declaration, which is
 * why the payroll modules now carry one as well.
 */
const RESTRICTED_PATTERNS: readonly RegExp[] = [
  /\bsalary\b/,
  /\bwage(s)?\b/,
  /\bctc\b/,
  /\bcompensation\b/,
  /\bpayroll\b/,
  /\bpayslip\b/,
  /\bearning(s)?\b/,
  /\bdeduction(s)?\b/,
  /\bgross\b/,
  /\bnet\s?(pay|salary|amount\s?payable)\b/,
  /\btake\s?home\b/,
  /\bpf\b/,
  /\bepf\b/,
  /\besi\b/,
  /\btds\b/,
  /\bgratuity\b/,
  /\bbonus\b/,
  /\bbank\s?(account|detail(s)?)\b/,
  /\baccount\s?(number|no)\b/,
  /\biban\b/,
  /\bifsc\b/,
  /\bswift\b/,
  /\brouting\s?(number|no)\b/,
  /\bsort\s?code\b/,
  /\bcard\s?(number|no)\b/,
  /\bpan\b/,
  /\buan\b/,
  /\besic\b/,
  /\baadhaar\b/,
  /\baadhar\b/,
  /\bssn\b/,
  /\bsocial\s?security\b/,
  /\bnational\s?id\b/,
  /\bpassport\b/,
  /\btax\s?id\b/,
  /\bdate\s?of\s?birth\b/,
  /\bbirth\s?date\b/,
  /\bdob\b/,
  /\bhome\s?address\b/,
  /\bpersonal\s?(email|phone|mobile)\b/,
];

/**
 * Collapse a key or label to a space-separated lower-case phrase.
 *
 * `bankAccountNumber` → `bank account number`, so one pattern covers camel
 * case, snake case and a human label.
 */
function normalizeName(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The class implied by a field's key and label alone. */
export function classifyFieldName(key: string, label = ''): SensitivityClass {
  const names = [normalizeName(key), normalizeName(label)].filter((n) => n.length > 0);
  for (const name of names) {
    if (SECRET_PATTERNS.some((re) => re.test(name))) return 'secret';
  }
  for (const name of names) {
    if (RESTRICTED_PATTERNS.some((re) => re.test(name))) return 'restricted';
  }
  return 'normal';
}

export interface ClassifiableField {
  key: string;
  label?: string;
  /**
   * An explicit declaration by the module author.
   *
   * `true` is accepted as `restricted` so the data-plane ontology's existing
   * boolean flag maps onto this scale without every call site translating it.
   * A declaration can only RAISE the class — a field named `apiKey` is secret
   * whatever anyone writes next to it.
   */
  sensitive?: SensitivityClass | boolean;
}

export function classifyField(field: ClassifiableField): SensitivityClass {
  const declared: SensitivityClass =
    field.sensitive === true ? 'restricted' : field.sensitive === false || field.sensitive === undefined ? 'normal' : field.sensitive;
  return moreRestrictive(declared, classifyFieldName(field.key, field.label ?? ''));
}

/** The reason a field was held back, in words a person can act on. */
export function sensitivityReason(cls: SensitivityClass): string {
  switch (cls) {
    case 'secret':
      return 'Authentication material — never included in an export.';
    case 'restricted':
      return 'Personal or financial identifier — included only when explicitly requested.';
    default:
      return '';
  }
}

/** The marker written in place of a value that must not be shown. */
export const REDACTED_MARKER = '••••••••';
