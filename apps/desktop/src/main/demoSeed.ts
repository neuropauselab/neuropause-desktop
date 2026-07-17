/**
 * Demo-seed gate (Product Integrity & Production Readiness v1.0).
 *
 * Fabricated "demo" fixtures — sample tenants, peer organizations, active SSO connections, marketplace
 * install counts, star ratings, usage history, DR/backup metrics, partner directories — must NEVER appear in
 * a production install. An enterprise customer's dashboards must show only their own real, earned data and
 * honest empty states. These fixtures remain useful for local development and demos, so rather than delete
 * them we gate every one behind this single OFF-BY-DEFAULT switch.
 *
 * Enable locally with `NP_DEMO_SEEDS=1`. In a packaged production build the variable is absent, so every
 * seed store consults this and skips its demo fixtures, seeding only real data (e.g. the home tenant derived
 * from the actual local organization). This module is intentionally Electron-free so the stores that import
 * it stay unit-testable under Node.
 */
export function demoSeedsEnabled(): boolean {
  return process.env.NP_DEMO_SEEDS === '1';
}
