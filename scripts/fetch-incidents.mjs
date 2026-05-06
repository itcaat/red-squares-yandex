/**
 * Скачивает инциденты с API (без CORS — запуск из Node на CI / локально перед сборкой).
 * Пишет public/data/incidents.json для статики Vite.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'data');
const OUT_FILE = join(OUT_DIR, 'incidents.json');

const API_BASE = (process.env.STATUS_API_BASE ?? 'https://status.yandex.cloud/api').replace(/\/$/, '');

function utcDateOnly(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addUtcDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function defaultFetchRange() {
  const now = new Date();
  return { from: utcDateOnly(addUtcDays(now, -400)), to: utcDateOnly(now) };
}

function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

async function fetchAllIncidents({ from, to, installation = 'all', zones = [] }) {
  const perPage = 500;
  let page = 1;
  const all = [];
  let total = Infinity;

  while (all.length < total) {
    const search = new URLSearchParams();
    search.set('lang', 'ru');
    search.set('from', from);
    search.set('to', to);
    search.set('installation', installation);
    search.set('page', String(page));
    search.set('perPage', String(perPage));
    for (const z of zones) {
      search.append('zones[]', z.trim());
    }

    const url = `${API_BASE}/incidents?${search.toString()}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      throw new Error(`Incidents ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    total = typeof data.count === 'number' ? data.count : data.items?.length ?? 0;
    const batch = data.items || [];
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 50) throw new Error('Слишком много страниц ответа API');
  }

  return dedupeById(all);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const range = defaultFetchRange();
  const items = await fetchAllIncidents({ ...range, installation: 'all', zones: [] });
  const payload = {
    fetchedAt: Date.now(),
    from: range.from,
    to: range.to,
    items,
  };
  writeFileSync(OUT_FILE, JSON.stringify(payload), 'utf8');
  console.log(`Wrote ${items.length} incidents → ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
