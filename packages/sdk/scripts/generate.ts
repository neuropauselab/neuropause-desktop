/**
 * Regenerate the typed EnterpriseResource from the shared route manifest.
 *   npm run generate -w @neuropause/sdk
 * The committed src/generated/enterprise.ts must always equal this output (a test
 * asserts it), so the SDK never drifts from the API contract.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTERPRISE_API_ROUTE_MANIFEST } from '@neuropause/shared';
import { generateEnterpriseResource } from '../src/codegen/generateEnterprise';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../src/generated/enterprise.ts');
writeFileSync(out, generateEnterpriseResource(ENTERPRISE_API_ROUTE_MANIFEST));
// eslint-disable-next-line no-console
console.log(`Generated ${out} from ${ENTERPRISE_API_ROUTE_MANIFEST.length} routes`);
