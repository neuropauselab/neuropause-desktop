import type { CatalogApp } from './types';

/**
 * The AI product catalog. Brand logos are deliberately not reproduced; each app
 * is represented by a tinted glyph tile. This catalog feeds the AI Store, the
 * Workspace launcher, and the command palette. A real, server-backed catalog
 * with pricing/reviews arrives in Phase 3.
 */
export const CATALOG: CatalogApp[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    developer: 'OpenAI',
    category: 'Writing',
    tagline: 'Conversational assistant for writing, analysis, and ideas.',
    tone: 'green',
    glyph: 'GPT',
    connected: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    developer: 'Anthropic',
    category: 'Writing',
    tagline: 'Thoughtful assistant for long-form work and reasoning.',
    tone: 'orange',
    glyph: 'Cl',
    connected: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    developer: 'Google',
    category: 'Research',
    tagline: 'Multimodal model wired into Google’s knowledge.',
    tone: 'blue',
    glyph: 'Gem',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    developer: 'Perplexity AI',
    category: 'Research',
    tagline: 'Answer engine with live citations.',
    tone: 'teal',
    glyph: 'Px',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    developer: 'Anysphere',
    category: 'Coding',
    tagline: 'The AI-native code editor.',
    tone: 'purple',
    glyph: 'Cur',
    connected: true,
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    developer: 'GitHub',
    category: 'Coding',
    tagline: 'Pair-programmer in your editor and terminal.',
    tone: 'accent',
    glyph: 'Co',
  },
  {
    id: 'midjourney',
    name: 'Midjourney',
    developer: 'Midjourney',
    category: 'Image',
    tagline: 'High-fidelity image generation.',
    tone: 'pink',
    glyph: 'Mj',
  },
  {
    id: 'runway',
    name: 'Runway',
    developer: 'Runway',
    category: 'Video',
    tagline: 'Generative video and editing tools.',
    tone: 'blue',
    glyph: 'Rw',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    developer: 'ElevenLabs',
    category: 'Voice',
    tagline: 'Natural speech synthesis and voice cloning.',
    tone: 'purple',
    glyph: '11',
  },
  {
    id: 'notion',
    name: 'Notion AI',
    developer: 'Notion',
    category: 'Productivity',
    tagline: 'AI woven into your docs and wikis.',
    tone: 'accent',
    glyph: 'No',
    connected: true,
  },
  {
    id: 'zapier',
    name: 'Zapier',
    developer: 'Zapier',
    category: 'Automation',
    tagline: 'Connect apps and automate workflows.',
    tone: 'orange',
    glyph: 'Zp',
  },
  {
    id: 'figma',
    name: 'Figma AI',
    developer: 'Figma',
    category: 'Image',
    tagline: 'Design assistance on the canvas.',
    tone: 'pink',
    glyph: 'Fig',
  },
];

const BY_ID = new Map(CATALOG.map((a) => [a.id, a]));

export function getApp(id: string): CatalogApp | undefined {
  return BY_ID.get(id);
}

/** Always returns a usable app descriptor, even for an unknown id. */
export function getAppOrFallback(id: string): CatalogApp {
  return (
    BY_ID.get(id) ?? {
      id,
      name: id,
      developer: 'Unknown',
      category: 'Productivity',
      tagline: '',
      tone: 'accent',
      glyph: id.slice(0, 2).toUpperCase(),
    }
  );
}

export const CATEGORIES: CatalogApp['category'][] = [
  'Writing',
  'Coding',
  'Image',
  'Video',
  'Voice',
  'Research',
  'Automation',
  'Productivity',
];
