const ALLOWED_ORIGINS = [
  'https://kalki-pattern-scorer-ui.pages.dev',
  'https://kalki-screener.pages.dev',
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
      const higherTimeframe = tf === '1d'
        ? await fetchHigherTimeframeChart(yticker)
        : null;

      const prompt = `PATTERN_SCORE_REQUEST: Analyze the ${tfLabel} OHLCV candle data for ${ticker}, identify the chart pattern, and respond with ONLY a raw JSON object (no markdown, no backticks, no explanation before or after).${note ? ` Alert note: "${note}"` : ''}

Yahoo source URL: ${yahooUrl}
Chart data JSON:
${JSON.stringify(chart)}
${higherTimeframe ? `
Higher-timeframe context URL: ${higherTimeframe.url}
Weekly context JSON:
${JSON.stringify(higherTimeframe.chart)}
` : ''}

JSON structure to return:
{"pattern":"<Cup and Handle|Head and Shoulders|Inverse Head and Shoulders|Low-base Breakout|Base Breakout|Megaphone|Bull Flag|Ascending Triangle|Double Bottom|Flat Base|Descending Channel|Earnings Gap Breakout|etc>","pattern_stage":"forming|breakout|confirmed|failed","timeframe":"${tfLabel}","score":<1-10>,"grade":"A+|A|B|C|D","price_context":{"current":<num>,"resistance":<num>,"support":<num>,"target":<num>},"bullish_factors":["...","...","..."],"risk_factors":["...","..."],"summary":"2-3 sentences on setup quality and what to watch","invalidation":"one sentence on what invalidates this setup"}

Pattern classification rules:
- First evaluate Head and Shoulders / Inverse Head and Shoulders before labeling Double Bottom.
- If the setup has three swing lows/highs with the middle swing clearly more extreme and price is breaking a neckline, label it "Inverse Head and Shoulders" for bullish breakouts or "Head and Shoulders" for bearish breakdowns.
- Only label "Double Bottom" when there are two comparable lows and no distinct middle head plus right shoulder structure.
- For deeply sold-off stocks still far below major weekly resistance, prefer "Low-base Breakout" or "Inverse Head and Shoulders attempt" over a clean bullish continuation label.
- If a human alert note names a pattern and the OHLCV structure reasonably supports it, use that pattern name instead of a simpler overlapping label.

Grading rules:
- Grade the setup quality, not just the size of the current green candle.
- Use weekly context to penalize heavy overhead supply, persistent downtrends, and nearby resistance.
- A/A+ requires daily breakout strength AND supportive weekly structure with room to run before major resistance.
- B means constructive but with meaningful overhead supply, early reversal risk, or unconfirmed follow-through.
- C/D means weak, failed, extended, or too close to resistance for good risk/reward.
- Breakouts from long downtrends should usually start as B/B+ unless they clear the first major weekly resistance with strong volume.
- Do not grade a valid breakout below B-/5 solely because the weekly trend is down if R:R is above 1.5 and volume/price action confirms accumulation.
- Weekly downtrend and overhead supply should usually cap a good reversal setup at B/B+, not automatically force C/D.

Rules for price_context: current must be the latest close/current market price. support MUST be below current. resistance MUST be above current. target MUST be above resistance. If price already broke a prior resistance, do not use that old resistance as resistance; choose the next upside resistance or measured move target.`;

      const data = await callAnthropic(env, prompt);
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) return jsonResponse({ error: 'Could not parse AI response', raw: text }, 500, corsOrigin);

      const result = normalizeAnalysisResult(JSON.parse(match[0]), chart);
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

async function fetchHigherTimeframeChart(yticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yticker}?interval=1wk&range=2y`;
  try {
    return {
      url,
      chart: await fetchYahooChart(url),
    };
  } catch (err) {
    return {
      url,
      chart: { error: err.message },
    };
  }
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

function normalizeAnalysisResult(result, chart) {
  const candles = chart.candles || [];
  const last = candles[candles.length - 1] || {};
  const recent = candles.slice(-60);
  const pc = result.price_context || {};
  const current = positiveNumber(pc.current) || positiveNumber(chart.current) || positiveNumber(last.c);
  if (!current) {
    result.price_context = pc;
    return result;
  }

  const highsAbove = uniqueNumbers(recent.map(c => c.h).filter(v => v > current * 1.002)).sort((a, b) => a - b);

  const support = chooseStopSupport(pc.support, current, recent);

  let resistance = positiveNumber(pc.resistance) && pc.resistance > current
    ? pc.resistance
    : highsAbove[0];

  if (!resistance || resistance <= current) {
    const riskPct = Math.max((current - support) / current, 0.04);
    resistance = current * (1 + Math.max(riskPct * 1.5, 0.06));
  }

  let target = positiveNumber(pc.target) && pc.target > resistance
    ? pc.target
    : resistance + Math.max(resistance - support, current * 0.06);

  result.price_context = {
    current: round(current),
    resistance: round(resistance),
    support: round(support),
    target: round(target),
  };

  const stopRiskPct = ((current - support) / current) * 100;
  const rrRatio = (resistance - current) / (current - support);
  result.rr_ratio = round(rrRatio);
  result.stop_pct = -round(stopRiskPct);
  if (stopRiskPct > 9) {
    result.risk_factors = [
      ...(Array.isArray(result.risk_factors) ? result.risk_factors : []),
      `Stop requires ${round(stopRiskPct)}% risk, which is wider than the preferred swing-trade risk band.`,
    ];
    capScore(result, 6);
  }
  applyScoreGuardrails(result, rrRatio);

  return result;
}

function applyScoreGuardrails(result, rrRatio) {
  const stage = String(result.pattern_stage || '').toLowerCase();
  const factors = [
    ...(Array.isArray(result.bullish_factors) ? result.bullish_factors : []),
    result.summary || '',
  ].join(' ').toLowerCase();
  const hasBreakout = stage === 'breakout' || stage === 'confirmed' || factors.includes('breakout');
  const hasVolume = factors.includes('volume') || factors.includes('accumulation');
  const score = Number(result.score);

  if (hasBreakout && hasVolume && rrRatio >= 1.5 && Number.isFinite(score) && score < 5) {
    result.score = 5;
    result.grade = gradeForScore(result.score);
    result.risk_factors = [
      ...(Array.isArray(result.risk_factors) ? result.risk_factors : []),
      'Weekly overhead supply limits the grade, but breakout confirmation and acceptable R:R keep the setup above a weak rating.',
    ];
  }

  if (rrRatio < 1 && Number.isFinite(score) && score > 5) {
    result.score = 5;
    result.grade = gradeForScore(result.score);
    result.risk_factors = [
      ...(Array.isArray(result.risk_factors) ? result.risk_factors : []),
      'R:R to first resistance is below 1:1, so the setup grade is capped.',
    ];
  }
}

function chooseStopSupport(candidate, current, recent) {
  const minStop = current * 0.96; // avoid random 1-2% noise stops
  const idealMaxStop = current * 0.91;
  const hardMaxStop = current * 0.88;
  const lowsBelow = uniqueNumbers(recent.map(c => c.l).filter(v => v < current * 0.998)).sort((a, b) => b - a);
  const swingLows = findSwingLows(recent)
    .filter(v => v < current * 0.998)
    .sort((a, b) => b - a);
  const candidates = uniqueNumbers([
    positiveNumber(candidate),
    ...swingLows,
    ...lowsBelow,
  ].filter(v => v && v < current));

  const ideal = candidates.find(v => v <= minStop && v >= idealMaxStop);
  if (ideal) return ideal;

  const technicalButWide = candidates.find(v => v < idealMaxStop && v >= hardMaxStop);
  if (technicalButWide) return technicalButWide;

  const tooTight = candidates.find(v => v > minStop);
  if (tooTight) return minStop;

  return current * 0.92;
}

function findSwingLows(candles) {
  const lows = [];
  for (let i = 2; i < candles.length - 2; i += 1) {
    const low = candles[i].l;
    if (!positiveNumber(low)) continue;
    if (
      low <= candles[i - 1].l &&
      low <= candles[i - 2].l &&
      low <= candles[i + 1].l &&
      low <= candles[i + 2].l
    ) {
      lows.push(low);
    }
  }
  return lows;
}

function capScore(result, maxScore) {
  const score = Number(result.score);
  if (Number.isFinite(score) && score > maxScore) {
    result.score = maxScore;
  }
  result.grade = gradeForScore(result.score);
}

function gradeForScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 'C';
  if (n >= 9) return 'A+';
  if (n >= 7) return 'A';
  if (n >= 5) return 'B';
  if (n >= 3) return 'C';
  return 'D';
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(v => typeof v === 'number' && Number.isFinite(v)).map(v => Math.round(v * 100) / 100))];
}
