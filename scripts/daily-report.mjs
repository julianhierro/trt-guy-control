#!/usr/bin/env node
/**
 * Daily TRT Guy report.
 *
 * Pulls yesterday's numbers for every tracked page, compares them with the day
 * before, and sends a short summary to Telegram.
 *
 * Runs on GitHub Actions — no server, no Vercel, nothing to keep alive.
 *
 * Needs two repo secrets:
 *   TELEGRAM_BOT_TOKEN   from @BotFather
 *   TELEGRAM_CHAT_ID     your own chat id
 */

const STATS = 'https://jv-dashboard-chi.vercel.app/api/pagestats';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT  = process.env.TELEGRAM_CHAT_ID;

// grouped the way the Control Center groups them
const FUNNELS = [
  { name: 'TRT 101 Guide',      gate: 'trtdad-101-gate',       pages: ['trtdad-101-gate','trtdad-101-thanks','trtdad-101-guide'] },
  { name: 'Injection Guide',    gate: 'trtdad-injection-gate', pages: ['trtdad-injection-gate','trtdad-injection-thanks','trtdad-injection-guide'] },
  { name: '5 Non-Negotiables',  gate: 'trtdad-rules-gate',     pages: ['trtdad-rules-gate','trtdad-rules-thanks'] },
  { name: '30 Emails 30 Days',  gate: 'trtdad-30days',         pages: ['trtdad-30days','trtdad-30days-confirm'] },
  { name: 'Low-T Quiz',         gate: 'trtdad-quiz',           pages: ['trtdad-quiz'] },
  { name: 'Coaching',           gate: 'trtdad-coaching-gate',  pages: ['trtdad-coaching-gate','trtdad-checkout','trtdad-checkout-paid'] },
  { name: 'Main Site',          gate: 'trtdad-site',           pages: ['trtdad-site'] },
];

const ymd = d => d.toISOString().slice(0, 10);
const dayAgo = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return ymd(d); };

async function stats(page, from, to) {
  try {
    const r = await fetch(`${STATS}?p=${encodeURIComponent(page)}&from=${from}&to=${to}`);
    const s = await r.json();
    return { views: +s.views || 0, visitors: +s.visitors || 0, optins: +s.optins || 0 };
  } catch {
    return { views: 0, visitors: 0, optins: 0 };
  }
}

async function totalsFor(day) {
  const out = { funnels: [], views: 0, visitors: 0, optins: 0 };
  for (const f of FUNNELS) {
    const rows = await Promise.all(f.pages.map(p => stats(p, day, day)));
    const views    = rows.reduce((a, r) => a + r.views, 0);
    const visitors = rows.reduce((a, r) => a + r.visitors, 0);
    const gate     = await stats(f.gate, day, day);
    out.funnels.push({ name: f.name, views, visitors, optins: gate.optins, gateVisitors: gate.visitors });
    out.views += views; out.visitors += visitors; out.optins += gate.optins;
  }
  return out;
}

const delta = (now, before) => {
  if (now === before) return '';
  const d = now - before;
  return ` (${d > 0 ? '+' : ''}${d})`;
};

function build(today, yesterday, day) {
  const cv = today.visitors ? ((today.optins / today.visitors) * 100).toFixed(1) : '0.0';
  const L = [];
  L.push(`*TRT Guy — ${day}*`);
  L.push('');
  L.push(`👀 ${today.views} views${delta(today.views, yesterday.views)}`);
  L.push(`👤 ${today.visitors} visitors${delta(today.visitors, yesterday.visitors)}`);
  L.push(`✅ *${today.optins} opt-ins*${delta(today.optins, yesterday.optins)}`);
  L.push(`📈 ${cv}% conversion`);
  L.push('');

  const active = today.funnels.filter(f => f.views > 0 || f.optins > 0)
                              .sort((a, b) => b.optins - a.optins || b.views - a.views);
  if (active.length) {
    L.push('*By funnel*');
    for (const f of active) {
      const c = f.gateVisitors ? ` · ${((f.optins / f.gateVisitors) * 100).toFixed(0)}%` : '';
      L.push(`• ${f.name} — ${f.optins} opt-in${f.optins === 1 ? '' : 's'}, ${f.views} views${c}`);
    }
  } else {
    L.push('_No traffic yesterday._');
  }

  L.push('');
  L.push('[Open the Control Center](https://julianhierro.github.io/trt-guy-control/)');
  return L.join('\n');
}

async function send(text) {
  if (!TOKEN || !CHAT) {
    console.log('No Telegram credentials set — printing instead:\n');
    console.log(text);
    return;
  }
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT, text, parse_mode: 'Markdown', disable_web_page_preview: true,
    }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error('Telegram rejected it: ' + JSON.stringify(j));
  console.log('Sent.');
}

const day = process.env.REPORT_DAY || dayAgo(1);
const prev = ymd(new Date(new Date(day).getTime() - 864e5));
const [t, y] = [await totalsFor(day), await totalsFor(prev)];
await send(build(t, y, day));
