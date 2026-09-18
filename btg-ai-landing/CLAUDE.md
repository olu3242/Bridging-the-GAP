# CLAUDE.md

Guidance for Claude (or any AI coding agent) working in this repository.

## What this repo is

A static marketing landing page for **BTG AI**. It is presentation-only:
there is no backend, no database, no authentication, and no application
logic here. Do not add any of those things unless explicitly asked —
this repo's job is to look good, load fast, and communicate clearly.

## Stack

- Plain HTML, CSS, and vanilla JavaScript. No framework, no bundler,
  no build step.
- Two Google Fonts (Space Grotesk, Inter) loaded via `<link>` tags.
- `package.json` exists only to run a local static file server
  (`npm start`) for preview — it is not a build pipeline.

## Conventions

- Keep everything in the three existing files: `index.html`,
  `css/style.css`, `js/script.js`. Don't introduce a framework or a
  build step without being asked.
- Design tokens (colors, fonts, spacing, radii) live as CSS custom
  properties in `:root` at the top of `style.css`. Reuse them; don't
  hardcode new hex values inline.
- Section order in `index.html` is intentional and commented
  (`<!-- ============ SECTION ============ -->`). Keep new sections
  consistently commented the same way.
- JavaScript stays framework-free and dependency-free. Keep it
  progressive-enhancement style: the page should be readable and
  navigable even if JS fails to load.
- Follow the existing accessibility baseline: semantic landmarks,
  visible focus states, `aria-expanded` on toggles, a skip link, and
  respect for `prefers-reduced-motion`. Don't regress these.
- Don't fabricate statistics, testimonials, logos, or claims about
  users, partners, or outcomes. If a stat or quote is needed, it must
  be provided by the person, not invented.
- The hero photo, feature icons, and product-preview screenshots in
  `assets/` were supplied by the client from their own brand kit —
  don't swap in a different stock photo, a real named public figure,
  or a third-party logo/trademark without it being explicitly supplied
  and cleared for use the same way.

## Making changes

- Copy edits: `index.html` only.
- Visual/style edits: `css/style.css`, via the token variables first.
- Behavior edits (nav toggle, FAQ accordion, etc.): `js/script.js`.
- After any change, sanity-check the page at mobile (~375px), tablet
  (~768px), and desktop (~1200px) widths — the responsive rules are in
  the `@media` blocks at the bottom of `style.css`.

## Out of scope for this repo

Product architecture, data models, engines, personas, or any internal
platform strategy for BTG AI belong in a separate, private
product/engineering repository — not in this public-facing landing
page. Keep this repo limited to what a visitor to the site should see.
