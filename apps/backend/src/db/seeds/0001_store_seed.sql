-- 0001_store_seed: representative AI Store catalog.
-- Inserted against an empty (freshly-truncated) store by db/seed.ts, so plain
-- INSERTs with slug-based parent lookups stay clean and readable. Covers every
-- app_type, pricing kind, verification tier, collection, and the permission and
-- packaging metadata that Stage 2 (NPMX + plugin SDK) and Stage 3 (UI) consume.

-- ── Organizations ───────────────────────────────────────────────────────────
INSERT INTO organizations (slug, name, description, website, is_enterprise) VALUES
  ('openai', 'OpenAI', 'AI research and deployment company.', 'https://openai.com', false),
  ('google', 'Google', 'Organizing the world''s information.', 'https://google.com', false),
  ('glean-inc', 'Glean', 'Enterprise work assistant and search.', 'https://glean.com', true);

-- ── Developers ──────────────────────────────────────────────────────────────
INSERT INTO developers (slug, name, kind, organization_id, website, bio) VALUES
  ('openai', 'OpenAI', 'organization', (SELECT id FROM organizations WHERE slug='openai'), 'https://openai.com', 'Makers of ChatGPT and the GPT models.'),
  ('anthropic', 'Anthropic', 'organization', NULL, 'https://anthropic.com', 'AI safety company and makers of Claude.'),
  ('google', 'Google', 'organization', (SELECT id FROM organizations WHERE slug='google'), 'https://deepmind.google', 'Gemini and DeepMind research.'),
  ('perplexity', 'Perplexity AI', 'organization', NULL, 'https://perplexity.ai', 'The answer engine.'),
  ('anysphere', 'Anysphere', 'organization', NULL, 'https://cursor.com', 'Builders of the Cursor editor.'),
  ('github', 'GitHub', 'organization', NULL, 'https://github.com', 'Where the world builds software.'),
  ('midjourney', 'Midjourney', 'organization', NULL, 'https://midjourney.com', 'Independent research lab for image generation.'),
  ('runway', 'Runway', 'organization', NULL, 'https://runwayml.com', 'Applied AI research for media.'),
  ('elevenlabs', 'ElevenLabs', 'organization', NULL, 'https://elevenlabs.io', 'Voice AI research and products.'),
  ('notion', 'Notion Labs', 'organization', NULL, 'https://notion.so', 'The connected workspace.'),
  ('zapier', 'Zapier', 'organization', NULL, 'https://zapier.com', 'Automation for busy people.'),
  ('figma', 'Figma', 'organization', NULL, 'https://figma.com', 'Collaborative interface design.'),
  ('ollama', 'Ollama', 'organization', NULL, 'https://ollama.com', 'Run large language models locally.'),
  ('langchain', 'LangChain', 'organization', NULL, 'https://langchain.com', 'Framework for LLM-powered apps.'),
  ('n8n', 'n8n', 'organization', NULL, 'https://n8n.io', 'Source-available workflow automation.'),
  ('significant-gravitas', 'Significant Gravitas', 'organization', NULL, 'https://agpt.co', 'Makers of AutoGPT.'),
  ('raycast', 'Raycast', 'organization', NULL, 'https://raycast.com', 'A blazing-fast launcher for macOS.'),
  ('glean', 'Glean', 'organization', (SELECT id FROM organizations WHERE slug='glean-inc'), 'https://glean.com', 'Enterprise AI search.'),
  ('superwhisper', 'Superwhisper', 'individual', NULL, 'https://superwhisper.com', 'On-device dictation for macOS.');

-- ── Verified developers ─────────────────────────────────────────────────────
INSERT INTO developer_verifications (developer_id, tier) VALUES
  ((SELECT id FROM developers WHERE slug='openai'), 'partner'),
  ((SELECT id FROM developers WHERE slug='anthropic'), 'partner'),
  ((SELECT id FROM developers WHERE slug='google'), 'partner'),
  ((SELECT id FROM developers WHERE slug='github'), 'partner'),
  ((SELECT id FROM developers WHERE slug='anysphere'), 'standard'),
  ((SELECT id FROM developers WHERE slug='perplexity'), 'standard'),
  ((SELECT id FROM developers WHERE slug='notion'), 'standard'),
  ((SELECT id FROM developers WHERE slug='figma'), 'standard'),
  ((SELECT id FROM developers WHERE slug='elevenlabs'), 'standard'),
  ((SELECT id FROM developers WHERE slug='ollama'), 'standard'),
  ((SELECT id FROM developers WHERE slug='n8n'), 'standard'),
  ((SELECT id FROM developers WHERE slug='glean'), 'enterprise');

-- ── Categories ──────────────────────────────────────────────────────────────
INSERT INTO categories (slug, name, icon, sort_order) VALUES
  ('writing', 'Writing', 'sparkles', 1),
  ('coding', 'Coding', 'workspace', 2),
  ('image', 'Image', 'grid', 3),
  ('video', 'Video', 'play', 4),
  ('voice', 'Voice', 'activity', 5),
  ('research', 'Research', 'memory', 6),
  ('automation', 'Automation', 'automations', 7),
  ('productivity', 'Productivity', 'checklist', 8),
  ('business', 'Business', 'analytics', 9),
  ('healthcare', 'Healthcare', 'info', 10),
  ('education', 'Education', 'lightbulb', 11),
  ('finance', 'Finance', 'analytics', 12),
  ('design', 'Design', 'grid', 13),
  ('data', 'Data', 'analytics', 14);

-- ── Tags ────────────────────────────────────────────────────────────────────
INSERT INTO tags (slug, label) VALUES
  ('llm', 'LLM'), ('chat', 'Chat'), ('agent', 'Agent'), ('mcp', 'MCP'),
  ('code', 'Code'), ('image-generation', 'Image Generation'), ('video', 'Video'),
  ('voice', 'Voice'), ('search', 'Search'), ('automation', 'Automation'),
  ('design', 'Design'), ('open-source', 'Open Source'), ('enterprise', 'Enterprise'),
  ('local', 'Local'), ('productivity', 'Productivity');

-- ── Update channels ─────────────────────────────────────────────────────────
INSERT INTO update_channels (slug, name, description, sort_order) VALUES
  ('stable', 'Stable', 'Production-ready releases.', 0),
  ('beta', 'Beta', 'Early access, mostly stable.', 1),
  ('canary', 'Canary', 'Bleeding edge nightly builds.', 2);

-- ── Applications ────────────────────────────────────────────────────────────
-- columns: slug, name, tagline, dev, category, app_type, pricing_kind, glyph, tone,
--          open_source, license, staff_pick, trending, installs, downloads,
--          launch_url, repository_url, first_published, latest_release
INSERT INTO applications
  (slug, name, tagline, developer_id, category_id, app_type, pricing_kind,
   icon_glyph, icon_tone, is_open_source, license, is_staff_pick, trending_score,
   install_count, download_count, homepage_url, launch_url, repository_url,
   first_published_at, latest_release_at, description)
SELECT
  d.slug, d.name, d.tagline,
  (SELECT id FROM developers WHERE slug = d.dev),
  (SELECT id FROM categories WHERE slug = d.cat),
  d.app_type, d.pricing, d.glyph, d.tone, d.oss, d.license, d.staff, d.trending,
  d.installs, d.downloads, d.home, d.launch, d.repo,
  d.first_pub::timestamptz, d.latest_rel::timestamptz, d.descr
FROM (VALUES
  ('chatgpt','ChatGPT','Conversational assistant for writing, analysis, and ideas.','openai','writing','web','freemium','GPT','green',false,NULL,true,980,1850000,0,'https://openai.com','https://chat.openai.com',NULL,'2022-11-30','2026-05-20','ChatGPT is a conversational assistant for drafting, editing, analysis, brainstorming, and everyday questions, with vision and tool use built in.'),
  ('claude','Claude','Thoughtful assistant for long-form work and reasoning.','anthropic','writing','web','freemium','Cl','orange',false,NULL,true,970,1320000,0,'https://anthropic.com','https://claude.ai',NULL,'2023-03-14','2026-06-10','Claude is an AI assistant from Anthropic built for careful reasoning, long-context work, coding, and writing, with a focus on being helpful, honest, and harmless.'),
  ('gemini','Gemini','Multimodal model wired into Google knowledge.','google','research','web','freemium','Gem','blue',false,NULL,false,910,1100000,0,'https://gemini.google.com','https://gemini.google.com',NULL,'2023-12-06','2026-05-01','Gemini is Google''s multimodal assistant spanning text, images, and code, connected to Search and Workspace.'),
  ('perplexity','Perplexity','Answer engine with live citations.','perplexity','research','web','freemium','Px','teal',false,NULL,true,880,740000,0,'https://perplexity.ai','https://perplexity.ai',NULL,'2022-12-07','2026-05-18','Perplexity is an answer engine that searches the web in real time and cites its sources for every response.'),
  ('cursor','Cursor','The AI-native code editor.','anysphere','coding','electron','freemium','Cur','purple',false,NULL,true,860,520000,310000,'https://cursor.com','https://cursor.com','https://github.com/getcursor/cursor','2023-03-14','2026-06-15','Cursor is a code editor built for pair-programming with AI: in-line edits, codebase-aware chat, and agentic multi-file changes.'),
  ('github-copilot','GitHub Copilot','Pair-programmer in your editor and terminal.','github','coding','desktop_plugin','subscription','Co','blue',false,NULL,true,900,980000,540000,'https://github.com/features/copilot','https://github.com/features/copilot',NULL,'2021-06-29','2026-06-02','GitHub Copilot suggests code and whole functions in real time, and answers questions about your codebase from the editor and CLI.'),
  ('midjourney','Midjourney','High-fidelity image generation.','midjourney','image','web','subscription','Mj','pink',false,NULL,false,840,690000,0,'https://midjourney.com','https://midjourney.com',NULL,'2022-07-12','2026-04-22','Midjourney generates high-fidelity images from text prompts, with fine control over style, lighting, and composition.'),
  ('runway','Runway','Generative video and editing tools.','runway','video','web','subscription','Rw','blue',false,NULL,false,760,410000,0,'https://runwayml.com','https://runwayml.com',NULL,'2021-12-08','2026-05-09','Runway offers generative video, motion brush, and a suite of AI editing tools for filmmakers and creators.'),
  ('elevenlabs','ElevenLabs','Natural speech synthesis and voice cloning.','elevenlabs','voice','web','freemium','11','purple',false,NULL,false,800,450000,0,'https://elevenlabs.io','https://elevenlabs.io',NULL,'2022-08-01','2026-05-30','ElevenLabs produces natural text-to-speech, dubbing, and voice cloning in dozens of languages.'),
  ('notion-ai','Notion AI','AI woven into your docs and wikis.','notion','productivity','web','freemium','No','neutral',false,NULL,false,820,610000,0,'https://notion.so','https://notion.so',NULL,'2023-02-22','2026-05-12','Notion AI drafts, summarizes, and answers questions across your docs, wikis, and projects.'),
  ('zapier','Zapier','Connect apps and automate workflows.','zapier','automation','web','freemium','Zp','orange',false,NULL,false,780,540000,0,'https://zapier.com','https://zapier.com',NULL,'2011-08-01','2026-06-01','Zapier connects thousands of apps with no-code automations, now with AI steps and agents.'),
  ('figma-ai','Figma AI','Design assistance on the canvas.','figma','design','web','freemium','Fig','pink',false,NULL,false,770,480000,0,'https://figma.com','https://figma.com',NULL,'2024-06-26','2026-04-18','Figma AI brings generative design, content, and search directly onto the canvas.'),
  ('ollama','Ollama','Run open LLMs locally on your machine.','ollama','coding','desktop_plugin','free','Ol','teal',true,'MIT',true,720,320000,420000,'https://ollama.com','https://ollama.com','https://github.com/ollama/ollama','2023-07-18','2026-06-12','Ollama runs open large language models locally with a single command, with a built-in model library and API.'),
  ('langchain','LangChain','Framework for building LLM apps and agents.','langchain','coding','automation','free','Lc','green',true,'MIT',false,650,280000,890000,'https://langchain.com',NULL,'https://github.com/langchain-ai/langchain','2022-10-17','2026-06-08','LangChain is an open-source framework for building applications and agents on top of language models.'),
  ('filesystem-mcp','Filesystem MCP','Model Context Protocol server for local files.','anthropic','automation','mcp_server','free','Fs','teal',true,'MIT',true,600,150000,260000,'https://modelcontextprotocol.io',NULL,'https://github.com/modelcontextprotocol/servers','2024-11-25','2026-05-28','A reference MCP server that exposes local files and directories to MCP-compatible AI clients with scoped permissions.'),
  ('n8n','n8n','Workflow automation you can self-host.','n8n','automation','automation','freemium','N8','pink',true,'Sustainable Use License',false,640,230000,510000,'https://n8n.io','https://n8n.io','https://github.com/n8n-io/n8n','2019-06-24','2026-06-05','n8n is a source-available workflow automation tool you can self-host, with hundreds of integrations and AI nodes.'),
  ('autogpt','AutoGPT','Autonomous AI agent platform.','significant-gravitas','automation','ai_agent','free','Ag','orange',true,'MIT',false,580,190000,640000,'https://agpt.co',NULL,'https://github.com/Significant-Gravitas/AutoGPT','2023-03-30','2026-05-15','AutoGPT is a platform for building, running, and sharing autonomous AI agents that chain tools to complete goals.'),
  ('raycast-ai','Raycast AI','AI commands in your launcher.','raycast','productivity','native','subscription','Ra','pink',false,NULL,false,690,260000,300000,'https://raycast.com','https://raycast.com',NULL,'2023-05-10','2026-06-03','Raycast AI brings chat, quick AI commands, and AI extensions to the macOS launcher.'),
  ('glean','Glean','Enterprise AI search across your company.','glean','business','web','enterprise','Gl','blue',false,NULL,true,700,90000,0,'https://glean.com','https://glean.com',NULL,'2021-09-01','2026-05-25','Glean is an enterprise work assistant that searches and reasons across all your company''s apps with permissions enforced.'),
  ('superwhisper','Superwhisper','On-device voice-to-text for macOS.','superwhisper','voice','native','paid','Sw','purple',false,NULL,false,560,70000,140000,'https://superwhisper.com','https://superwhisper.com',NULL,'2024-01-15','2026-05-20','Superwhisper transcribes your voice to text entirely on-device, anywhere on macOS, with custom modes.')
) AS d(slug, name, tagline, dev, cat, app_type, pricing, glyph, tone, oss, license, staff, trending, installs, downloads, home, launch, repo, first_pub, latest_rel, descr);

-- ── App ↔ tag links ─────────────────────────────────────────────────────────
INSERT INTO app_tags (application_id, tag_id)
SELECT (SELECT id FROM applications WHERE slug = m.app), (SELECT id FROM tags WHERE slug = m.tag)
FROM (VALUES
  ('chatgpt','llm'),('chatgpt','chat'),('chatgpt','productivity'),
  ('claude','llm'),('claude','chat'),('claude','code'),
  ('gemini','llm'),('gemini','search'),('gemini','chat'),
  ('perplexity','search'),('perplexity','llm'),
  ('cursor','code'),('cursor','llm'),
  ('github-copilot','code'),('github-copilot','llm'),
  ('midjourney','image-generation'),('midjourney','design'),
  ('runway','video'),('runway','image-generation'),
  ('elevenlabs','voice'),
  ('notion-ai','productivity'),('notion-ai','llm'),
  ('zapier','automation'),('zapier','productivity'),
  ('figma-ai','design'),('figma-ai','image-generation'),
  ('ollama','llm'),('ollama','local'),('ollama','open-source'),('ollama','code'),
  ('langchain','llm'),('langchain','agent'),('langchain','open-source'),('langchain','code'),
  ('filesystem-mcp','mcp'),('filesystem-mcp','open-source'),('filesystem-mcp','automation'),
  ('n8n','automation'),('n8n','open-source'),
  ('autogpt','agent'),('autogpt','open-source'),('autogpt','automation'),
  ('raycast-ai','productivity'),
  ('glean','search'),('glean','enterprise'),
  ('superwhisper','voice'),('superwhisper','local')
) AS m(app, tag);

-- ── Versions (1.0.0 historical + a current version per app) ──────────────────
INSERT INTO versions (application_id, version, is_prerelease)
SELECT id, '1.0.0', false FROM applications;

INSERT INTO versions (application_id, version, is_prerelease)
SELECT (SELECT id FROM applications WHERE slug = c.app), c.version, false
FROM (VALUES
  ('chatgpt','4.2.0'),('claude','3.8.0'),('gemini','2.5.0'),('perplexity','3.1.0'),
  ('cursor','0.42.0'),('github-copilot','1.21.0'),('midjourney','6.1.0'),('runway','3.4.0'),
  ('elevenlabs','2.9.0'),('notion-ai','2.3.0'),('zapier','5.7.0'),('figma-ai','1.4.0'),
  ('ollama','0.5.4'),('langchain','0.3.7'),('filesystem-mcp','0.6.2'),('n8n','1.62.0'),
  ('autogpt','0.9.1'),('raycast-ai','1.84.0'),('glean','4.0.0'),('superwhisper','1.9.0')
) AS c(app, version);

-- ── Releases (current version on the stable channel) ─────────────────────────
INSERT INTO releases
  (application_id, version_id, channel_id, artifact_url, artifact_size_bytes,
   sha256, signature_key_id, min_host_version, status, released_at)
SELECT
  a.id, ver.id, ch.id,
  CASE WHEN a.app_type = 'web' THEN NULL
       ELSE 'https://registry.neuropause.app/packages/' || a.slug || '/' || c.version || '.npkg' END,
  CASE WHEN a.app_type = 'web' THEN NULL ELSE (24000000 + (random() * 80000000)::bigint) END,
  CASE WHEN a.app_type = 'web' THEN NULL ELSE encode(digest(a.slug || '@' || c.version, 'sha256'), 'hex') END,
  CASE WHEN a.app_type = 'web' THEN NULL ELSE a.slug || ':key-1' END,
  '0.1.0', 'published', a.latest_release_at
FROM applications a
JOIN (VALUES
  ('chatgpt','4.2.0'),('claude','3.8.0'),('gemini','2.5.0'),('perplexity','3.1.0'),
  ('cursor','0.42.0'),('github-copilot','1.21.0'),('midjourney','6.1.0'),('runway','3.4.0'),
  ('elevenlabs','2.9.0'),('notion-ai','2.3.0'),('zapier','5.7.0'),('figma-ai','1.4.0'),
  ('ollama','0.5.4'),('langchain','0.3.7'),('filesystem-mcp','0.6.2'),('n8n','1.62.0'),
  ('autogpt','0.9.1'),('raycast-ai','1.84.0'),('glean','4.0.0'),('superwhisper','1.9.0')
) AS c(app, version) ON c.app = a.slug
JOIN versions ver ON ver.application_id = a.id AND ver.version = c.version
JOIN update_channels ch ON ch.slug = 'stable';

-- ── Changelogs (for the current version) ────────────────────────────────────
INSERT INTO changelogs (application_id, version_id, body, highlights, published_at)
SELECT a.id, ver.id,
  'Performance improvements and bug fixes in this release.',
  '["Faster responses","Improved reliability","Refined interface"]'::jsonb,
  a.latest_release_at
FROM applications a
JOIN (VALUES
  ('chatgpt','4.2.0'),('claude','3.8.0'),('gemini','2.5.0'),('perplexity','3.1.0'),
  ('cursor','0.42.0'),('github-copilot','1.21.0'),('midjourney','6.1.0'),('runway','3.4.0'),
  ('elevenlabs','2.9.0'),('notion-ai','2.3.0'),('zapier','5.7.0'),('figma-ai','1.4.0'),
  ('ollama','0.5.4'),('langchain','0.3.7'),('filesystem-mcp','0.6.2'),('n8n','1.62.0'),
  ('autogpt','0.9.1'),('raycast-ai','1.84.0'),('glean','4.0.0'),('superwhisper','1.9.0')
) AS c(app, version) ON c.app = a.slug
JOIN versions ver ON ver.application_id = a.id AND ver.version = c.version;

-- ── Screenshots (3 per app) ─────────────────────────────────────────────────
INSERT INTO screenshots (application_id, url, thumbnail_url, width, height, sort_order)
SELECT a.id,
  'https://picsum.photos/seed/' || a.slug || '-' || g || '/1280/800',
  'https://picsum.photos/seed/' || a.slug || '-' || g || '/480/300',
  1280, 800, g
FROM applications a, generate_series(1, 3) AS g;

-- ── Pricing plans ───────────────────────────────────────────────────────────
INSERT INTO pricing_plans (application_id, name, price_cents, interval, features, is_default, sort_order)
SELECT id, 'Free', 0, 'month', '["Core features","Community support"]'::jsonb, true, 0
FROM applications WHERE pricing_kind IN ('free', 'freemium');

INSERT INTO pricing_plans (application_id, name, price_cents, interval, features, is_default, sort_order)
SELECT id, 'Pro', 2000, 'month', '["Everything in Free","Higher limits","Priority access"]'::jsonb, false, 1
FROM applications WHERE pricing_kind = 'freemium';

INSERT INTO pricing_plans (application_id, name, price_cents, interval, features, is_default, sort_order)
SELECT id, 'Pro', 2000, 'month', '["Full access","Priority support"]'::jsonb, true, 0
FROM applications WHERE pricing_kind = 'subscription';

INSERT INTO pricing_plans (application_id, name, price_cents, interval, features, is_default, sort_order)
SELECT id, 'Lifetime license', 8400, 'once', '["One-time purchase","Free minor updates"]'::jsonb, true, 0
FROM applications WHERE pricing_kind = 'paid';

INSERT INTO pricing_plans (application_id, name, price_cents, interval, features, is_default, sort_order)
SELECT id, 'Enterprise', 0, 'custom', '["SSO and SCIM","Dedicated support","Custom data controls","Audit logs"]'::jsonb, true, 0
FROM applications WHERE pricing_kind = 'enterprise';

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'network', true, 'Connects to its services over the internet.' FROM applications;

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'filesystem_read', true, 'Reads local files and folders you select.'
FROM applications WHERE app_type IN ('electron','desktop_plugin','native','mcp_server','ai_agent','automation');

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'filesystem_write', false, 'Writes output files into folders you choose.'
FROM applications WHERE app_type IN ('electron','desktop_plugin','native','mcp_server','ai_agent','automation');

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'clipboard', false, 'Reads and writes the clipboard for quick actions.'
FROM applications WHERE app_type IN ('electron','desktop_plugin','native');

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'notifications', false, 'Sends you desktop notifications.'
FROM applications WHERE app_type IN ('electron','desktop_plugin','native');

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'automation', true, 'Runs automated actions across tools on your behalf.'
FROM applications WHERE app_type IN ('ai_agent','automation','mcp_server');

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'local_models', true, 'Loads and runs AI models locally on your machine.'
FROM applications WHERE slug = 'ollama';

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'background', false, 'Continues running tasks in the background.'
FROM applications WHERE app_type = 'ai_agent' OR slug = 'ollama';

INSERT INTO app_permissions (application_id, permission, required, reason)
SELECT id, 'microphone', true, 'Captures audio from your microphone for transcription.'
FROM applications WHERE slug = 'superwhisper';

-- ── Plugin packages (one per app, manifest derived from declared permissions) ─
INSERT INTO plugin_packages (application_id, version_id, runtime, entry, manifest, sandbox, sha256, signature_key_id)
SELECT
  a.id, ver.id, a.app_type,
  COALESCE(a.launch_url, a.repository_url, 'npmx://' || a.slug),
  jsonb_build_object(
    'name', a.slug,
    'displayName', a.name,
    'version', c.version,
    'runtime', a.app_type,
    'entry', COALESCE(a.launch_url, a.repository_url, 'npmx://' || a.slug),
    'host', jsonb_build_object('minVersion', '0.1.0'),
    'permissions', COALESCE(
      (SELECT jsonb_agg(permission ORDER BY permission) FROM app_permissions p WHERE p.application_id = a.id),
      '[]'::jsonb)
  ),
  CASE a.app_type
    WHEN 'web' THEN 'iframe'
    WHEN 'native' THEN 'none'
    WHEN 'mcp_server' THEN 'process'
    WHEN 'ai_agent' THEN 'container'
    WHEN 'automation' THEN 'process'
    ELSE 'process' END,
  CASE WHEN a.app_type = 'web' THEN NULL ELSE encode(digest(a.slug || '@' || c.version, 'sha256'), 'hex') END,
  CASE WHEN a.app_type = 'web' THEN NULL ELSE a.slug || ':key-1' END
FROM applications a
JOIN (VALUES
  ('chatgpt','4.2.0'),('claude','3.8.0'),('gemini','2.5.0'),('perplexity','3.1.0'),
  ('cursor','0.42.0'),('github-copilot','1.21.0'),('midjourney','6.1.0'),('runway','3.4.0'),
  ('elevenlabs','2.9.0'),('notion-ai','2.3.0'),('zapier','5.7.0'),('figma-ai','1.4.0'),
  ('ollama','0.5.4'),('langchain','0.3.7'),('filesystem-mcp','0.6.2'),('n8n','1.62.0'),
  ('autogpt','0.9.1'),('raycast-ai','1.84.0'),('glean','4.0.0'),('superwhisper','1.9.0')
) AS c(app, version) ON c.app = a.slug
JOIN versions ver ON ver.application_id = a.id AND ver.version = c.version;

-- ── Collections ─────────────────────────────────────────────────────────────
INSERT INTO collections (slug, title, subtitle, kind, auto_rule, is_featured, accent, sort_order) VALUES
  ('essential-assistants', 'Essential AI Assistants', 'The assistants people reach for every day.', 'manual', NULL, true, 'indigo', 1),
  ('build-with-code', 'Build with Code', 'Ship faster with AI in your editor.', 'manual', NULL, true, 'purple', 2),
  ('create-and-design', 'Create & Design', 'Generate images, video, voice, and interfaces.', 'manual', NULL, true, 'pink', 3),
  ('automate-everything', 'Automate Everything', 'Agents, workflows, and MCP servers.', 'manual', NULL, true, 'orange', 4),
  ('trending-now', 'Trending Now', 'What the community is installing this week.', 'auto', 'trending', true, 'blue', 5),
  ('new-and-notable', 'New & Notable', 'Fresh arrivals worth a look.', 'auto', 'new', false, 'teal', 6),
  ('staff-picks', 'Staff Picks', 'Hand-selected by the NeuroPause team.', 'auto', 'staff_picks', false, 'green', 7);

INSERT INTO collection_apps (collection_id, application_id, sort_order)
SELECT (SELECT id FROM collections WHERE slug = m.col), (SELECT id FROM applications WHERE slug = m.app), m.ord
FROM (VALUES
  ('essential-assistants','chatgpt',0),('essential-assistants','claude',1),('essential-assistants','gemini',2),('essential-assistants','perplexity',3),
  ('build-with-code','cursor',0),('build-with-code','github-copilot',1),('build-with-code','ollama',2),('build-with-code','langchain',3),
  ('create-and-design','midjourney',0),('create-and-design','runway',1),('create-and-design','figma-ai',2),('create-and-design','elevenlabs',3),
  ('automate-everything','zapier',0),('automate-everything','n8n',1),('automate-everything','autogpt',2),('automate-everything','filesystem-mcp',3)
) AS m(col, app, ord);

-- ── Featured banner ─────────────────────────────────────────────────────────
INSERT INTO featured_apps (application_id, headline, subheadline, accent, cta_label, sort_order)
SELECT (SELECT id FROM applications WHERE slug = f.app), f.headline, f.sub, f.accent, f.cta, f.ord
FROM (VALUES
  ('claude','Claude, now in your Workspace','Long-context reasoning and coding, a tab away.','orange','Open Claude',0),
  ('cursor','Code at the speed of thought','The AI-native editor your whole team will want.','purple','Get Cursor',1),
  ('glean','AI search for your whole company','Enterprise-grade, permission-aware knowledge.','blue','Talk to sales',2)
) AS f(app, headline, sub, accent, cta, ord);

-- ── Seed reviewer users (kept across re-seeds) + reviews ────────────────────
INSERT INTO users (email, display_name) VALUES
  ('reviewer.alice@neuropause.dev', 'Alice Nguyen'),
  ('reviewer.ben@neuropause.dev', 'Ben Carter'),
  ('reviewer.chloe@neuropause.dev', 'Chloe Martin'),
  ('reviewer.diego@neuropause.dev', 'Diego Alvarez')
ON CONFLICT (email) DO NOTHING;

INSERT INTO reviews (application_id, user_id, rating, title, body)
SELECT (SELECT id FROM applications WHERE slug = r.app),
       (SELECT id FROM users WHERE email = r.email),
       r.rating, r.title, r.body
FROM (VALUES
  ('chatgpt','reviewer.alice@neuropause.dev',5,'My daily driver','Fast, flexible, and great for drafting anything.'),
  ('chatgpt','reviewer.ben@neuropause.dev',4,'Very capable','Occasionally verbose but consistently useful.'),
  ('chatgpt','reviewer.chloe@neuropause.dev',5,'Indispensable','I use it for outlines, code, and email every day.'),
  ('claude','reviewer.alice@neuropause.dev',5,'Best for long docs','Handles big context better than anything else I have tried.'),
  ('claude','reviewer.diego@neuropause.dev',5,'Thoughtful answers','Reasoning quality is excellent for analysis work.'),
  ('claude','reviewer.ben@neuropause.dev',4,'Great writing partner','Tone is natural and easy to steer.'),
  ('gemini','reviewer.chloe@neuropause.dev',4,'Strong multimodal','Image understanding is a highlight.'),
  ('perplexity','reviewer.diego@neuropause.dev',5,'Citations win','I trust answers more when I can click the source.'),
  ('perplexity','reviewer.alice@neuropause.dev',4,'Great for research','Replaces a dozen tabs.'),
  ('cursor','reviewer.ben@neuropause.dev',5,'Changed how I code','The multi-file edits are genuinely impressive.'),
  ('cursor','reviewer.chloe@neuropause.dev',4,'Powerful','Takes a day to learn, then you fly.'),
  ('github-copilot','reviewer.diego@neuropause.dev',4,'Solid autocomplete','Saves real time on boilerplate.'),
  ('midjourney','reviewer.alice@neuropause.dev',5,'Stunning output','The quality ceiling is very high.'),
  ('runway','reviewer.ben@neuropause.dev',4,'Fun and capable','Video tools keep getting better.'),
  ('elevenlabs','reviewer.chloe@neuropause.dev',5,'Lifelike voices','Best TTS I have used.'),
  ('notion-ai','reviewer.diego@neuropause.dev',4,'Handy in context','Summaries inside my notes are great.'),
  ('zapier','reviewer.alice@neuropause.dev',4,'Reliable automations','Connects everything I need.'),
  ('ollama','reviewer.ben@neuropause.dev',5,'Local and private','Running models offline is a game changer.'),
  ('ollama','reviewer.chloe@neuropause.dev',5,'So easy','One command and it just works.'),
  ('langchain','reviewer.diego@neuropause.dev',4,'Flexible framework','Great for prototyping agents.'),
  ('n8n','reviewer.alice@neuropause.dev',4,'Self-hosting wins','Powerful once you get going.'),
  ('glean','reviewer.ben@neuropause.dev',5,'Enterprise search done right','Finds things across all our tools.'),
  ('raycast-ai','reviewer.chloe@neuropause.dev',5,'AI in my launcher','Quick commands are addictive.'),
  ('superwhisper','reviewer.diego@neuropause.dev',4,'On-device dictation','Private and accurate.')
) AS r(app, email, rating, title, body);
