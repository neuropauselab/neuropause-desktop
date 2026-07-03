/**
 * SDKs & Documentation. The published SDK catalog (TypeScript, CLI, Python, REST,
 * Webhooks) with install commands and what each can build, plus copy-paste
 * quickstarts for the client, the CLI, and webhook verification.
 */
import { OpsPanel } from '@renderer/operations/primitives';
import { EmptyState } from '@renderer/components/ui/EmptyState';
import { Icon, type IconName } from '@renderer/components/ui/Icon';
import { useDeveloper } from './DeveloperProvider';
import { CodeBlock } from './primitives';
import type { SdkLanguage } from '@neuropause/shared';

const LANG_ICON: Record<SdkLanguage, IconName> = {
  typescript: 'code',
  python: 'code',
  rest: 'globe',
  cli: 'command',
  webhooks: 'bolt',
};

const TS_QUICKSTART = `import { NeuroPauseClient, defineWorker } from '@neuropause/sdk';

const np = new NeuroPauseClient({
  apiKey: process.env.NEUROPAUSE_API_KEY,
});

// Read the marketplace
const listings = await np.marketplace.list();

// Build and publish an AI worker
const worker = defineWorker({
  name: 'Research Analyst',
  version: '1.0.0',
  entry: 'worker/main.js',
  permissions: ['workers:read'],
  role: 'research',
});

const version = await np.marketplace.publishVersion(
  'lst_123',
  worker.toManifest(),
  'Initial release',
);
await np.marketplace.submit(version.id);`;

const CLI_QUICKSTART = `export NEUROPAUSE_API_KEY=npk_live_xxxxx

neuropause marketplace list
neuropause usage
neuropause publish lst_123 ./manifest.json`;

const WEBHOOK_QUICKSTART = `import { verifyWebhook, parseWebhook } from '@neuropause/sdk';

// In your webhook handler:
const signature = req.headers['x-neuropause-signature'];
if (!verifyWebhook(rawBody, signature, process.env.WEBHOOK_SECRET)) {
  return res.status(400).send('invalid signature');
}

const event = parseWebhook(rawBody);
// event.type === 'listing.published' | 'gateway.rate_limited' | ...`;

export function SdkDocsPanel(): JSX.Element {
  const { sdks } = useDeveloper();

  return (
    <div>
      <OpsPanel title="SDKs" subtitle="Build AI workers, connectors, plugins, and enterprise extensions">
        {sdks.length === 0 ? (
          <EmptyState icon="package" title="Loading SDKs…" compact />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {sdks.map((s) => (
              <div key={s.language} className="surface-raised rounded-2xl p-5 shadow-card">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl [background:var(--fill-2)]"><Icon name={LANG_ICON[s.language]} size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold tracking-tight">{s.name}</h3>
                      <span className="rounded-md [background:var(--fill-2)] px-1.5 py-0.5 font-mono text-2xs text-faint">{s.version}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{s.description}</p>
                  </div>
                </div>
                <div className="mt-3"><CodeBlock value={s.install} /></div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.builds.map((b) => (
                    <span key={b} className="rounded-lg [background:var(--fill-1)] px-2 py-0.5 text-2xs font-medium text-muted">{b}</span>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-2xs text-faint"><Icon name="doc" size={12} />{s.docsPath}</div>
              </div>
            ))}
          </div>
        )}
      </OpsPanel>

      <OpsPanel title="Quickstart" subtitle="From zero to a published package">
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon name="code" size={15} /> TypeScript / JavaScript</div>
            <CodeBlock value={TS_QUICKSTART} />
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon name="command" size={15} /> CLI</div>
            <CodeBlock value={CLI_QUICKSTART} />
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Icon name="bolt" size={15} /> Webhooks</div>
            <CodeBlock value={WEBHOOK_QUICKSTART} />
          </div>
        </div>
      </OpsPanel>
    </div>
  );
}
