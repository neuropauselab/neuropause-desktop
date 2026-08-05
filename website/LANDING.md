# LANDING — NeuroPause public website

`website/index.html` — a single self-contained page (no build step, no
dependencies; fonts from Google Fonts CDN). Open it in any browser or host it
statically. Customer-facing only; touches zero application code.

## Design thesis
NeuroPause is cognitive infrastructure — a quiet operating layer beneath your
work. The site avoids the AI-default cream/terracotta and acid-green looks in
favor of a deep "observatory ink" palette with a single signal-cyan accent, a
wide geometric display face (Space Grotesk) paired with a humanist body (Inter).

**Signature element:** the hero is not a big-number stat block — it's a living
memory timeline that animates in on load (GitHub → Claude → Notion → Calendar →
Slack), footed by a sample Mission Brief. It shows, in five seconds, exactly what
the product does: watch your work, remember it, brief you. This directly attacks
audit finding C4 (Founder AI / Mission Brief were undiscoverable) by making them
the hero.

## Sections
Nav (sticky, blurred) · Hero + timeline signature · trust strip · Features (6
cards: Founder AI, Mission Brief, Engineering AI, Executive Memory,
Organizations, Private-by-design) · Pricing (4 tiers) · Download (macOS +
Windows) · FAQ · CTA band · Footer.

## Copy stance
Positions against "just another chatbot" — the operating-layer thesis in the
hero, reinforced in the FAQ. Every claim is true to the shipped product (16
connectors, on-device Ollama, permission-based tracking, local-first memory with
OS-keychain-encrypted credentials).

## To host
Any static host: Netlify/Vercel drop, GitHub Pages, Cloudflare Pages, or the
`neuropause033.com` root you already own. It's one file.
