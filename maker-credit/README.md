# PJM maker credit

The small "Designed and built by [PJM]" footer credit used on every PJM site
(Zandy Touch, Aurashots, Kigali Keys, ...). This folder is the single source of
truth; copy from here, don't copy from the last project.

| File | Purpose |
|---|---|
| `footer-credit.html` | Markup. Paste inside the footer's bottom row. SVG is inlined so it takes its colour from CSS. |
| `maker-credit.css` | The four rules. Append to the site stylesheet. |
| `maker-mark.svg` | Standalone master of the mark (for favicons, decks, README banners). Not used by the footer. |

## Per-project settings
- **Colour:** define `--maker-mark` in the project's design tokens. Must be >= 3:1
  against the footer surface (WCAG non-text contrast). Default fallback `#84cc16`
  gives ~10:1 on black and ~4:1 on a mid-dark green; on a light footer pick a darker value.
- **Link:** `mailto:` by default. Swap the `href` if there's a portfolio page.
- **Client work:** the credit is on by default. Agree it with the client up front and
  remove it if they decline.

## Wiring it in
1. Add the snippet to the footer (static partial, or a JS-rendered footer — wrap in the
   project's DOM helper, keeping the SVG attributes).
2. Append `maker-credit.css`; set `--maker-mark` in the tokens file.
3. Check the footer at 360px: the credit wraps under the legal line, nothing overflows.
