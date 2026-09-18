# BTG AI — Landing Page

A static marketing landing page for **BTG AI** ("Bridge The Gap AI"), with a
header/navigation bar, hero, "how it works" steps, feature highlights, a
partners section, an FAQ accordion, and a footer.

No build step, no framework, and no external dependencies beyond two Google
Fonts and (optionally) a tiny static file server for local preview.

## Structure

```
btg-ai-landing/
├── index.html          # All page markup and content
├── css/
│   └── style.css        # Design tokens + full responsive styling
├── js/
│   └── script.js         # Mobile nav toggle, FAQ accordion, footer year
├── assets/               # brand photo, feature icons, product-preview screenshots
├── package.json          # Convenience scripts for local preview
├── CLAUDE.md              # Working notes for Claude Code / AI agents
├── AGENT.md               # Same notes, framework-agnostic naming
└── README.md              # You are here
```

## Running it locally

You don't need Node.js to view this — you can just open `index.html`
directly in a browser. If you'd like a local server (recommended, so
relative paths behave the same as they would in production):

```bash
npm install
npm start
```

This serves the folder at `http://localhost:3000`.

## Deploying it

This is a plain static site, so it can be deployed as-is to any static
host (Netlify, Vercel, GitHub Pages, S3 + CloudFront, etc.) — just upload
the contents of this folder.

## Editing content

All page copy and structure lives in `index.html`. It's organized into
clearly commented sections:

- Header / navigation
- Hero
- Trust strip
- How it works (5 steps)
- Feature modules (6 cards)
- Dark CTA banner
- Partners (universities / employers / sponsors)
- FAQ
- Footer

Colors, type, spacing, and radii are all defined as CSS custom properties
at the top of `css/style.css` under `:root` — change a value there and it
updates everywhere it's used.

## Design tokens

| Token | Value | Use |
|---|---|---|
| `--indigo` | `#1E1B4B` | Primary text, brand, dark UI |
| `--violet` | `#7C3AED` | Primary accent, CTAs |
| `--emerald` | `#10B981` | Secondary accent |
| `--gold` | `#F59E0B` | Tertiary accent, highlights |
| `--ice` | `#F8FAFC` | Page background |
| `--slate` | `#475569` | Body copy |
| `--near-black` | `#0F172A` | Dark section backgrounds |

Typefaces: **Space Grotesk** (headings) + **Inter** (body), loaded from
Google Fonts.

## Assets

Everything in `assets/` comes from the client-supplied brand kit:

- `hero-photo.jpg` — the hero photo/illustration, cropped from the
  supplied hero mockup
- `icon-*.png` — the eight feature icons, sliced from the supplied icon sheet
- `dashboard-preview.jpg` / `mobile-preview.jpg` — product screenshots used
  in the "One home base. Any device." section

If you replace any of these, keep the same standard: no real, identifiable
people and no third-party logos/trademarks without explicit rights to use them.

## Notes

- This page is marketing/presentation content only — it does not include
  any application logic, backend, database, or product architecture.
- All copy avoids fabricated statistics or unverifiable claims.
- Accessibility basics are in place: skip link, visible focus states,
  semantic landmarks, `aria-expanded` on interactive controls, and
  `prefers-reduced-motion` support.
