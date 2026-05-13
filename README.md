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

The Pages project was created as a direct-upload project, so Cloudflare shows `No Git connection`. That is okay. This repo uses GitHub Actions to deploy both Cloudflare apps whenever `main` is pushed.

Required GitHub repo secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

After those are added in GitHub, pushing to `main` deploys:

```text
src/worker.js       -> kalki-pattern-scorer Worker
public/index.html   -> kalki-pattern-scorer-ui Pages
```

Last GitHub Actions deploy test: 2026-05-13 14:07 EDT.

## Local Commands

```bash
npm install
npm run check
npm run worker:deploy
npm run pages:deploy
npm run deploy
```

`npm run pages:deploy` is only the manual fallback. Normal flow should be:

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
