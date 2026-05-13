# Kalki Pattern Scorer

One repo for the Kalki Pattern Scorer Cloudflare app.

## Live URLs

- UI: https://kalki-pattern-scorer-ui.pages.dev/
- Worker API: https://kalki-pattern-scorer.srimanthgada87.workers.dev/
- GitHub: https://github.com/srimanth87/kalki-pattern-scorer

## Source Of Truth

```text
public/index.html   Cloudflare Pages UI
src/worker.js       Cloudflare Worker API
wrangler.toml       Cloudflare config for Worker and Pages output
index.html          Redirect only, kept for GitHub/root visitors
```

Do not edit the root `index.html` for the app UI. The real UI is `public/index.html`.

## Cloudflare Setup

Cloudflare should have two applications for this repo:

```text
kalki-pattern-scorer      Worker API, deploys src/worker.js
kalki-pattern-scorer-ui   Pages UI, publishes public/
```

The Worker is already connected to GitHub. The Pages project currently shows `Git Provider: No`, so it is still a manual Wrangler deploy. To make Pages auto-sync from GitHub:

1. Open Cloudflare Dashboard -> Workers & Pages -> `kalki-pattern-scorer-ui`.
2. Connect Git repository: `srimanth87/kalki-pattern-scorer`.
3. Production branch: `main`.
4. Build command: leave blank.
5. Build output directory: `public`.
6. Save.

After that, pushing to `main` will deploy the Pages UI automatically.

## Local Commands

```bash
npm install
npm run check
npm run worker:deploy
npm run pages:deploy
npm run deploy
```

`npm run pages:deploy` is only the manual fallback. Once Pages is Git-connected, normal flow should be:

```bash
git add .
git commit -m "Your change"
git push origin main
```

## Required Cloudflare Variables

Worker variables/secrets:

```text
ANTHROPIC_API_KEY   Secret
ANTHROPIC_MODEL     Plaintext, optional. Example: claude-sonnet-4-6
```

Telegram bot token and chat id are entered from the UI Settings panel and stored in the browser for now.
