/**
 * @neuropause/certification — the Enterprise Validation & Production Certification
 * harness (NCEA 16.0). VALIDATION TOOLING ONLY: it introduces no runtime or
 * platform feature, no new subsystem, and duplicates nothing. It exposes exactly
 * two things — the four-tier evidence matrix and a real benchmark harness — and
 * ships end-to-end / compatibility / benchmark tests that exercise the existing
 * eleven packages to record actual evidence. Everything requiring customer
 * infrastructure, cloud services, production traffic, or an external audit is
 * INFRA-PENDING or PILOT-VERIFIED — never fabricated as VERIFIED.
 */
export * from './constants';
export * from './validationMatrix';
export * from './bench';
