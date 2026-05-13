const ALLOWED_ORIGIN = 'https://kalki-pattern-scorer-ui.pages.dev';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Secret',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/analyze') {
      return new Response('Not found', { status: 404 });
    }

    // Secret token check — blocks unauthorized direct API calls
    const token = request.headers.get('X-Worker-Secret');
    if (token !== env.WORKER_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      const body = await request.json();
      const { ticker, timeframe, note } = body;

      if (!ticker) return jsonResponse({ error: 'ticker is required' }, 400);

      const tf = timeframe || '1d';
      const tfLabel = tf === '1wk' ? 'weekly' : 'daily';
      const range = tf === '1wk' ? '2y' : '6mo';
      const yticker = { SPX: '%5EGSPC', NDX: '%5ENDX', VIX: '%5EVIX' }[ticker] || ticker;
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yticker}?interval=${tf}&range=${range}`;

      const prompt = `PATTERN_SCORE_REQUEST: Fetch this Yahoo Finance URL, analyze the ${tfLabel} OHLCV candle data for ${ticker}, identify the chart pattern, and respond with ONLY a raw JSON object (no markdown, no backticks, no explanation before or after).${note ? ` Alert note: "${note}"` : ''}

URL: ${yahooUrl}

JSON structure to return:
{"pattern":"<Cup and Handle|Head and Shoulders|Megaphone|Bull Flag|Ascending Triangle|Base Breakout|Double Bottom|Flat Base|Descending Channel|Earnings Gap Breakout|etc>","pattern_stage":"forming|breakout|confirmed|failed","timeframe":"${tfLabel}","score":<1-10>,"grade":"A+|A|B|C|D","price_context":{"current":<num>,"resistance":<num>,"support":<num>,"target":<num>},"bullish_factors":["...","...","..."],"risk_factors":["...","..."],"summary":"2-3 sentences on setup quality and what to watch","invalidation":"one sentence on what invalidates this setup"}`;

      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!anthropicRes.ok) {
        const err = await anthropicRes.text();
        return jsonResponse({ error: `Anthropic API error: ${anthropicRes.status}`, detail: err }, 500);
      }

      const data = await anthropicRes.json();
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) return jsonResponse({ error: 'Could not parse AI response', raw: text }, 500);

      const result = JSON.parse(match[0]);
      return jsonResponse({ ok: true, result });

    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN },
  });
}
