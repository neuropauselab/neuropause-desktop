/**
 * Minimal ambient declaration for js-yaml (used only by the asset-validation tests to really parse
 * the deployment manifests). Avoids adding a @types dependency for the two functions we call.
 */
declare module 'js-yaml' {
  export function load(input: string): unknown;
  export function loadAll(input: string): unknown[];
}
