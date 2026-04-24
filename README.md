# Wax Wishlist

Static React app for showing a vinyl wishlist with cover art, quick filtering, and Amazon lookup links.

## What it does

- Shows your wishlist as a searchable wall of record cards
- Searches Apple's public album catalog from inside the app as you type
- Lets you add an album directly from the search dropdown with one click
- Uses direct Amazon links when you provide them, or falls back to an Amazon search link
- Stores your current list in `localStorage`

## Local development

```bash
npm install
npm run dev
```

## GitHub Pages deployment

This repo includes a GitHub Actions workflow that deploys the built site to GitHub Pages whenever you push to `main` or `master`.

### One-time GitHub setup

1. Push this repo to GitHub.
2. In GitHub, open `Settings` -> `Pages`.
3. Set the source to `GitHub Actions`.

After that, every push will publish the latest version.

## Notes

- The current app data is browser-local and stays in `localStorage` on that browser.
- Catalog search is powered by Apple's iTunes Search API, which is a good fit for a static front-end app.
- If you want a true shared wishlist that syncs across devices automatically, the next step would be adding a backend or database service.
