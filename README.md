# Kalki Pattern Scorer

Static UI plus Cloudflare Worker API for AI-powered chart pattern scoring.

## Deploy

Deploy the Worker API:

```bash
npm run worker:deploy
```

Deploy the Cloudflare Pages UI:

```bash
npm run pages:deploy
```

Deploy both:

```bash
npm run deploy
```

The UI is deployed from `public/`. It calls the Worker at:

```text
https://kalki-pattern-scorer.srimanthgada87.workers.dev/analyze
```
