const ALLOWED_ORIGINS = [
  'https://kalki-pattern-scorer-ui.pages.dev',
  'https://srimanth87.github.io',
];

const ANTHROPIC_MODELS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const corsOrigin = getCorsOrigin(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(corsOrigin),
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(corsOrigin) });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === '/telegram-alert') {
        return sendTelegramAlert(request, corsOrigin);
      }

      if (url.pathname !== '/analyze') {
        return new Response('Not found', { status: 404, headers: corsHeaders(corsOrigin) });
      }

      const body = await request.json();
      const { ticker, timeframe, note } = body;

      if (!ticker) return jsonResponse({ error: 'ticker is required' }, 400, corsOrigin);

      const tf = timeframe || '1d';
      const tfLabel = tf === '1wk' ? 'weekly' : 'daily';
      const range = tf === '1wk' ? '2y' : '6mo';
      const yticker = { SPX: '%5EGSPC', NDX: '%5ENDX', VIX: '%5EVIX' }[ticker] || ticker;
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yticker}?interval=${tf}&range=${range}`;
      const chart = await fetchYahooChart(yahooUrl);

      const prompt = `PATTERN_SCORE_REQUEST: Analyze the ${tfLabel} OHLCV candle data for ${ticker}, identify the chart pattern, and respond with ONLY a raw JSON object (no markdown, no backticks, no explanation before or after).${note ? ` Alert note: "${note}"` : ''}

Yahoo source URL: ${yahooUrl}
Chart data JSON:
${JSON.stringify(chart)}

JSON structure to return:
{"pattern":"<Cup and Handle|Head and Shoulders|Megaphone|Bull Flag|Ascending Triangle|Base Breakout|Double Bottom|Flat Base|Descending Channel|Earnings Gap Breakout|etc>","pattern_stage":"forming|breakout|confirmed|failed","timeframe":"${tfLabel}","score":<1-10>,"grade":"A+|A|B|C|D","price_context":{"current":<num>,"resistance":<num>,"support":<num>,"target":<num>},"bullish_factors":["...","...","..."],"risk_factors":["...","..."],"summary":"2-3 sentences on setup quality and what to watch","invalidation":"one sentence on what invalidates this setup"}`;

      const data = await callAnthropic(env, prompt);
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) return jsonResponse({ error: 'Could not parse AI response', raw: text }, 500, corsOrigin);

      const result = JSON.parse(match[0]);
      return jsonResponse({ ok: true, result }, 200, corsOrigin);

    } catch (err) {
      return jsonResponse({ error: err.message }, 500, corsOrigin);
    }
  },
};

function jsonResponse(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function getCorsOrigin(origin) {
  if (!origin) return '*';
  if (origin === 'null') return 'null';
  return ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.startsWith(`${allowed}/`)) ? origin : ALLOWED_ORIGINS[0];
}

async function sendTelegramAlert(request, corsOrigin) {
  const { botToken, chatId, text } = await request.json();

  if (!botToken) return jsonResponse({ error: 'Telegram bot token is required' }, 400, corsOrigin);
  if (!chatId) return jsonResponse({ error: 'Telegram chat id is required' }, 400, corsOrigin);
  if (!text) return jsonResponse({ error: 'Telegram message text is required' }, 400, corsOrigin);

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const description = data.description || `Telegram API error ${res.status}`;
    return jsonResponse({ error: description }, res.ok ? 400 : res.status, corsOrigin);
  }

  return jsonResponse({ ok: true }, 200, corsOrigin);
}

async function fetchYahooChart(yahooUrl) {
  const res = await fetch(yahooUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 KalkiPatternScorer/1.0',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance error: ${res.status}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const description = data?.chart?.error?.description || 'No chart data returned';
    throw new Error(`Yahoo Finance error: ${description}`);
  }

  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const closes = quote.close || [];
  const start = Math.max(0, timestamps.length - 120);
  const candles = [];

  for (let i = start; i < timestamps.length; i += 1) {
    if (closes[i] == null) continue;
    candles.push({
      t: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      o: round(quote.open?.[i]),
      h: round(quote.high?.[i]),
      l: round(quote.low?.[i]),
      c: round(quote.close?.[i]),
      v: quote.volume?.[i] ?? null,
    });
  }

  return {
    symbol: result.meta?.symbol,
    currency: result.meta?.currency,
    current: round(result.meta?.regularMarketPrice),
    previousClose: round(result.meta?.chartPreviousClose),
    candles,
  };
}

async function callAnthropic(env, prompt) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const models = unique([env.ANTHROPIC_MODEL, ...ANTHROPIC_MODELS].filter(Boolean));
  const errors = [];

  for (const model of models) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (res.ok) {
      return res.json();
    }

    const detail = await res.text();
    errors.push(`${model}: ${res.status} ${detail}`);
    if (res.status !== 404) {
      throw new Error(`Anthropic API error: ${res.status} ${detail}`);
    }
  }

  throw new Error(`No configured Anthropic model is available. Tried: ${errors.join(' | ')}`);
}

function round(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : null;
}

function unique(values) {
  return [...new Set(values)];
}
