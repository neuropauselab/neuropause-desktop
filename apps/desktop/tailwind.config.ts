import type { Config } from 'tailwindcss';

/**
 * Tailwind is scoped to the renderer. The design language follows Apple's HIG:
 * SF system type, a single calm accent (system indigo), generous spacing, and
 * translucent layered materials that sit over the macOS window vibrancy.
 *
 * Colors are driven by CSS custom properties (channel triplets) defined in
 * index.css so every token works in light and dark and accepts an /alpha.
 * The translucent *materials* (glass panels, fills, hairlines) are component
 * classes in index.css, since they need precise per-theme rgba.
 */
const channel = (name: string): string => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          // Round 36 — Gate 12: the channels moved to `--*-ch`; `--accent`
          // itself is now a wrapped COLOR so direct `var(--accent)` consumers
          // are valid. Tailwind's alpha variants keep reading the channels.
          DEFAULT: channel('--accent-ch'),
          hover: channel('--accent-hover-ch'),
          fg: channel('--accent-fg-ch'),
        },
        ink: channel('--text'),
        subtle: channel('--text-2'),
        faint: channel('--text-3'),
        // Apple system semantic colors (per-theme variants set in index.css).
        sysblue: channel('--c-blue'),
        sysgreen: channel('--c-green'),
        sysorange: channel('--c-orange'),
        syspurple: channel('--c-purple'),
        systeal: channel('--c-teal'),
        syspink: channel('--c-pink'),
        sysyellow: channel('--c-yellow'),
        // Retained from Phase 1 so the existing login screen keeps working.
        surface: {
          base: 'rgba(255,255,255,0.04)',
          raised: 'rgba(255,255,255,0.07)',
          border: 'rgba(255,255,255,0.10)',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'SF Pro Display',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
      fontSize: {
        // A deliberate macOS-flavoured type scale.
        '2xs': ['10.5px', { lineHeight: '14px', letterSpacing: '0.02em' }],
        xs: ['11.5px', { lineHeight: '16px' }],
        sm: ['12.5px', { lineHeight: '17px' }],
        base: ['13.5px', { lineHeight: '19px' }],
        md: ['14.5px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '22px', letterSpacing: '-0.01em' }],
        xl: ['19px', { lineHeight: '24px', letterSpacing: '-0.015em' }],
        '2xl': ['24px', { lineHeight: '29px', letterSpacing: '-0.02em' }],
        '3xl': ['30px', { lineHeight: '34px', letterSpacing: '-0.022em' }],
        '4xl': ['38px', { lineHeight: '42px', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        lg: '10px',
        xl: '14px',
        '2xl': '18px',
        '3xl': '24px',
      },
      boxShadow: {
        glass: '0 24px 64px -24px rgba(0,0,0,0.55)',
        pop: '0 12px 32px -12px rgba(0,0,0,0.45), 0 2px 8px -4px rgba(0,0,0,0.30)',
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -16px rgba(0,0,0,0.20)',
        focus: '0 0 0 3.5px rgb(var(--accent-ch) / 0.35)',
      },
      transitionTimingFunction: {
        // macOS-like spring-ish easing for non-physics transitions.
        emphasized: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
