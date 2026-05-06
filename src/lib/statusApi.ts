import type { SlimIncident } from './aggregate';

const DEFAULT_PUBLIC_BASE = 'https://status.yandex.cloud/api';

type InstallationCode = 'all' | 'ru' | 'kz';

/** Зоны из публичного API статуса (см. также essentialkaos/ycs). */
export const ZONE_OPTIONS: { id: string; label: string; region: 'ru' | 'kz' }[] = [
  { id: 'ru-central1-a', label: 'ru-central1-a', region: 'ru' },
  { id: 'ru-central1-b', label: 'ru-central1-b', region: 'ru' },
  { id: 'ru-central1-c', label: 'ru-central1-c', region: 'ru' },
  { id: 'ru-central1-d', label: 'ru-central1-d', region: 'ru' },
  { id: 'ru-central1-e', label: 'ru-central1-e', region: 'ru' },
  { id: 'kz1-a', label: 'kz1-a', region: 'kz' },
];

export const ALL_ZONE_IDS: string[] = ZONE_OPTIONS.map((z) => z.id);

/** Если выбраны все зоны — в запрос не передаём `zones[]` (как «все зоны» в API). */
export function normalizeZonesForRequest(selectedZoneIds: string[]): string[] {
  const sel = [...new Set(selectedZoneIds)].sort();
  const all = [...ALL_ZONE_IDS].sort();
  if (sel.length === all.length && sel.every((id, i) => id === all[i])) return [];
  return sel;
}

/** В dev/preview Vite проксирует `/status-proxy` → `https://status.yandex.cloud/api` (см. vite.config.ts). */
export function getStatusApiBase(): string {
  const env = import.meta.env.VITE_STATUS_API_BASE?.replace(/\/$/, '');
  if (env) return env;
  if (import.meta.env.DEV) return '/status-proxy';
  return DEFAULT_PUBLIC_BASE;
}

export type RawIncident = {
  id: number;
  title: string;
  startDate: string;
  endDate: string | null;
  status: string;
  levelId: number;
  services?: { fullName?: string; name?: string }[];
  /** Если API отдаёт список зон на инцидент — используется для фильтра */
  zones?: string[];
  installations?: {
    code?: string;
    zones?: { id?: string }[];
  }[];
};

type IncidentsResponse = {
  items: RawIncident[];
  count: number;
};

function utcDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addUtcDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

const INSTALLATION_LABEL: Record<string, string> = {
  ru: 'Россия',
  kz: 'Казахстан',
};

/** Строка для попапа: регион и зоны из поля installations ответа API */
export function formatIncidentRegions(inc: RawIncident): string | undefined {
  const blocks = inc.installations;
  if (!Array.isArray(blocks) || blocks.length === 0) return undefined;
  const chunks: string[] = [];
  for (const block of blocks) {
    const code = String(block.code ?? '').trim().toLowerCase();
    const title = INSTALLATION_LABEL[code] ?? (code ? code.toUpperCase() : '');
    const zoneIds = (block.zones ?? [])
      .map((z) => String(z.id ?? '').trim())
      .filter(Boolean);
    const uniq = [...new Set(zoneIds)];
    if (!title && uniq.length === 0) continue;
    if (uniq.length) chunks.push(title ? `${title} (${uniq.join(', ')})` : uniq.join(', '));
    else chunks.push(title);
  }
  return chunks.length ? chunks.join(' · ') : undefined;
}

export function slimIncident(inc: RawIncident, nowMs: number): SlimIncident | null {
  const a = Date.parse(inc.startDate);
  const endKnown = inc.endDate != null && inc.endDate !== '';
  const b = endKnown ? Date.parse(inc.endDate as string) : inc.status === 'open' ? nowMs : NaN;

  if (Number.isNaN(a)) return null;
  if (Number.isNaN(b)) return null;

  /** Игнорируем перепутанные метки начала/конца (в выборке API такое встречается). */
  const s = Math.min(a, b);
  const e = Math.max(a, b);

  const region = formatIncidentRegions(inc);

  return {
    id: inc.id,
    t: inc.title,
    s,
    e,
    l: inc.levelId,
    open: inc.status === 'open',
    u: `https://status.yandex.cloud/ru/incidents/${inc.id}`,
    ...(region ? { region } : {}),
  };
}

function dedupeById(items: RawIncident[]): RawIncident[] {
  const seen = new Set<number>();
  const out: RawIncident[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function incidentsRequestUrl(params: URLSearchParams): string {
  const base = getStatusApiBase().replace(/\/$/, '');
  const path = `${base}/incidents?${params.toString()}`;
  if (base.startsWith('http')) return path;
  return new URL(path, window.location.origin).toString();
}

export type FetchIncidentsParams = {
  from: string;
  to: string;
  installation?: InstallationCode;
  /** Пустой массив — не фильтровать по зонам; иначе передать в API как `zones[]`. */
  zones?: string[];
};

export async function fetchAllIncidents(opts: FetchIncidentsParams): Promise<RawIncident[]> {
  const perPage = 500;
  let page = 1;
  const all: RawIncident[] = [];
  let total = Infinity;
  const installation = opts.installation ?? 'all';
  const zones = opts.zones ?? [];

  while (all.length < total) {
    const search = new URLSearchParams();
    search.set('lang', 'ru');
    search.set('from', opts.from);
    search.set('to', opts.to);
    search.set('installation', installation);
    search.set('page', String(page));
    search.set('perPage', String(perPage));
    for (const z of zones) {
      search.append('zones[]', z.trim());
    }

    const res = await fetch(incidentsRequestUrl(search), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Incidents ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as IncidentsResponse;
    total = typeof data.count === 'number' ? data.count : data.items?.length ?? 0;
    const batch = data.items || [];
    all.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 50) throw new Error('Слишком много страниц ответа API');
  }

  return dedupeById(all);
}

export function buildIncidents(raw: RawIncident[], nowMs: number): SlimIncident[] {
  return raw
    .map((i) => slimIncident(i, nowMs))
    .filter((x): x is SlimIncident => x != null)
    .sort((a, b) => a.s - b.s);
}

export function defaultFetchRange(): { from: string; to: string } {
  const now = new Date();
  const to = utcDateOnly(now);
  const from = utcDateOnly(addUtcDays(now, -400));
  return { from, to };
}

/** Снимок для статики: кладётся в public/data/incidents.json при сборке (scripts/fetch-incidents.mjs). */
export type IncidentsSnapshot = {
  fetchedAt: number;
  from: string;
  to: string;
  items: RawIncident[];
};

/**
 * Фильтр по зонам для клиента (полный снимок без zones[] в URL).
 * Если в карточке есть zones[] — по ним; иначе по подстроке zone id в services (эвристика).
 * Нет services — считаем, что инцидент глобальный для выбранных фильтров (оставляем в выборке).
 */
export function filterRawIncidentsByZones(raw: RawIncident[], zonesForApi: string[]): RawIncident[] {
  if (zonesForApi.length === 0) return raw;
  const wanted = zonesForApi.map((z) => z.trim().toLowerCase());
  return raw.filter((inc) => rawIncidentTouchesSelectedZones(inc, wanted));
}

function rawIncidentTouchesSelectedZones(inc: RawIncident, zoneIdsLower: string[]): boolean {
  const fromApi = inc.zones;
  if (Array.isArray(fromApi) && fromApi.length > 0) {
    const set = new Set(fromApi.map((z) => String(z).toLowerCase()));
    return zoneIdsLower.some((z) => set.has(z));
  }
  const services = inc.services ?? [];
  if (services.length === 0) return true;
  const blob = services.map((s) => `${s.fullName ?? ''}\n${s.name ?? ''}`).join('\n').toLowerCase();
  return zoneIdsLower.some((z) => blob.includes(z));
}

export async function loadIncidentsFromStatic(baseUrl: string): Promise<IncidentsSnapshot> {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const res = await fetch(`${root}data/incidents.json`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`data/incidents.json: HTTP ${res.status}`);
  }
  const data = (await res.json()) as IncidentsSnapshot;
  if (!Array.isArray(data.items)) {
    throw new Error('incidents.json: ожидался массив items');
  }
  return data;
}

/** Для dev, если нет локального JSON — тот же набор через прокси Vite. */
export async function fetchSnapshotViaApi(): Promise<IncidentsSnapshot> {
  const range = defaultFetchRange();
  const items = await fetchAllIncidents({ ...range, installation: 'all', zones: [] });
  return {
    fetchedAt: Date.now(),
    from: range.from,
    to: range.to,
    items,
  };
}

