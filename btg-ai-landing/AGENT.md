# AGENT.md

Framework-agnostic instructions for any AI agent (Claude, ChatGPT, Copilot,
Cursor, etc.) working in this repository. See also `CLAUDE.md`, which
covers the same ground for Claude specifically — keep both in sync if you
update one.

## Purpose of this repo

This is the public marketing landing page for **BTG AI**. It is
presentation-only. There is no backend, no database, no auth, and no
product logic in this repository — just a fast, accessible, static page.

## Stack summary

- Static HTML/CSS/JS. No framework. No bundler. No build step.
- `index.html` — all markup and copy.
- `css/style.css` — all styling and design tokens.
- `js/script.js` — small, dependency-free progressive-enhancement script.
- `package.json` — only provides `npm start` to preview locally via a
  static file server.

## Ground rules for agents

1. **Stay static.** Don't introduce a frontend framework, a build
   pipeline, or a backend unless the person explicitly asks for one.
2. **Use the tokens.** Colors, fonts, spacing, and radii are CSS custom
   properties in `css/style.css` under `:root`. Change values there,
   not inline, so the whole page stays consistent.
3. **Don't invent facts.** No fabricated statistics, testimonials,
   partner logos, or outcome claims. If real ones are supplied later,
   add them; until then, keep copy honest and unverifiable-claim-free.
4. **Don't add real people or third-party marks.** The hero photo,
   feature icons, and preview screenshots in `assets/` are from the
   client's own brand kit. Don't replace them with a stock photo of a
   real, identifiable person or an unlicensed third-party logo.
5. **Keep accessibility intact.** Skip link, semantic landmarks, visible
   focus states, `aria-expanded` on the nav toggle and FAQ accordion,
   and `prefers-reduced-motion` support are all load-bearing — preserve
   them when you touch related markup or CSS.
6. **Keep scope narrow.** Internal product architecture, data models,
   or business strategy for BTG AI does not belong in this repo. This
   is the public-facing page only.

## Where to make a given change

| Change | File |
|---|---|
| Copy, section order, new sections | `index.html` |
| Colors, type, spacing, layout | `css/style.css` |
| Nav toggle, FAQ accordion, any interactivity | `js/script.js` |
| Local preview scripts | `package.json` |

## Verifying a change

There's no test suite (it's a static page). Before calling a change
done:

1. Open `index.html` directly, or run `npm start` and load
   `http://localhost:3000`.
2. Check mobile (~375px), tablet (~768px), and desktop (~1200px)
   widths.
3. Tab through the page with the keyboard — the skip link, nav, and
   FAQ accordion should all be reachable and usable without a mouse.
4. Confirm no console errors in the browser dev tools.
