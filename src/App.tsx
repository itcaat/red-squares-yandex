import { useEffect, useMemo, useState } from 'react';
import {
  countDaysWithIncidents,
  findWorstDay,
  incidentsTouchingDay,
  minutesAffectedOnDay,
  sumDowntimeDays,
  utcMidnight,
} from './lib/aggregate';
import { buildHeatGrid, monthLabelsForGrid } from './lib/calendar';
import {
  ALL_ZONE_IDS,
  ZONE_OPTIONS,
  buildIncidents,
  fetchSnapshotViaApi,
  filterRawIncidentsByZones,
  loadIncidentsFromStatic,
  normalizeZonesForRequest,
  type IncidentsSnapshot,
} from './lib/statusApi';
import './App.css';

/** Шкала по p95 дня вместо сырого максимума — один выброс не красит всё в один тон. */
function colorScaleMax(dailyMinutes: number[]): number {
  const pos = dailyMinutes.filter((m) => m > 0).sort((a, b) => a - b);
  if (pos.length === 0) return 1;
  const i = Math.min(pos.length - 1, Math.floor(0.95 * (pos.length - 1)));
  return Math.max(pos[i], 1);
}

function bucketLevel(minutes: number, scaleMax: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (scaleMax <= 0) return 1;
  const x = Math.min(1, minutes / scaleMax);
  if (x <= 0.25) return 1;
  if (x <= 0.5) return 2;
  if (x <= 0.75) return 3;
  return 4;
}

function formatDayRu(d: Date): string {
  return d.toLocaleDateString('ru-RU', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMinutesShort(m: number): string {
  if (m >= 60) return `${(m / 60).toFixed(1)} ч`;
  return `${Math.round(m)} мин`;
}

function levelLabel(level: number): string {
  if (level === 1) return 'Minor';
  if (level === 2) return 'Unavailable';
  return `Уровень ${level}`;
}

const TOOLTIP_MAX = 5;

export function App() {
  const [snapshot, setSnapshot] = useState<IncidentsSnapshot | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'err'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [minor, setMinor] = useState(true);
  const [unavailable, setUnavailable] = useState(true);
  const [pickedZones, setPickedZones] = useState<string[]>(() => [...ALL_ZONE_IDS]);
  const [hoverTip, setHoverTip] = useState<{ day: Date; x: number; y: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const zonesForApi = useMemo(() => normalizeZonesForRequest(pickedZones), [pickedZones]);

  const incidents = useMemo(() => {
    if (!snapshot) return [];
    const raw = filterRawIncidentsByZones(snapshot.items, zonesForApi);
    return buildIncidents(raw, Date.now());
  }, [snapshot, zonesForApi]);

  const fetchedAt = snapshot?.fetchedAt ?? null;

  useEffect(() => {
    if (!selectedDay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedDay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedDay]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoadState('loading');
    const base = import.meta.env.BASE_URL;
    loadIncidentsFromStatic(base)
      .catch(async (err) => {
        if (!import.meta.env.DEV) throw err;
        console.warn('Нет data/incidents.json — запрос к API через прокси dev', err);
        return fetchSnapshotViaApi();
      })
      .then((snap) => {
        if (cancelled) return;
        setSnapshot(snap);
        setLoadState('ok');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoadState('err');
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const levels = useMemo(() => {
    const s = new Set<number>();
    if (minor) s.add(1);
    if (unavailable) s.add(2);
    return s;
  }, [minor, unavailable]);

  const effectiveLevels = levels.size > 0 ? levels : new Set<number>([1, 2]);

  const rangeEnd = useMemo(() => {
    const now = new Date();
    return utcMidnight(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  }, []);

  const rangeStart = useMemo(() => {
    const d = new Date(rangeEnd.getTime());
    d.setUTCDate(d.getUTCDate() - 364);
    return d;
  }, [rangeEnd]);

  const { weeks, gridStartSunday, cells } = useMemo(
    () => buildHeatGrid(rangeStart, rangeEnd),
    [rangeStart, rangeEnd],
  );

  const monthLabels = useMemo(
    () => monthLabelsForGrid(gridStartSunday, weeks),
    [gridStartSunday, weeks],
  );

  const allZonesSelected = useMemo(() => normalizeZonesForRequest(pickedZones).length === 0, [pickedZones]);

  const toggleZone = (id: string) => {
    setPickedZones((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev;
        return prev.filter((z) => z !== id);
      }
      return [...prev, id].sort();
    });
  };

  const dailyMinutes = useMemo(() => {
    const list: number[] = [];
    for (const cell of cells) {
      if (!cell.inRange) continue;
      list.push(minutesAffectedOnDay(cell.date, incidents, effectiveLevels));
    }
    return list;
  }, [cells, incidents, effectiveLevels]);

  const colorScale = useMemo(() => colorScaleMax(dailyMinutes), [dailyMinutes]);

  const summary = useMemo(() => {
    const downtimeDays = sumDowntimeDays(incidents, effectiveLevels, rangeStart, rangeEnd);
    const daysHit = countDaysWithIncidents(incidents, effectiveLevels, rangeStart, rangeEnd);
    const worst = findWorstDay(incidents, effectiveLevels, rangeStart, rangeEnd);
    return { downtimeDays, daysHit, worst };
  }, [incidents, effectiveLevels, rangeStart, rangeEnd]);

  const selectedRows = useMemo(
    () => (selectedDay ? incidentsTouchingDay(selectedDay, incidents, effectiveLevels) : []),
    [selectedDay, incidents, effectiveLevels],
  );

  const hoverRows = useMemo(
    () => (hoverTip ? incidentsTouchingDay(hoverTip.day, incidents, effectiveLevels) : []),
    [hoverTip, incidents, effectiveLevels],
  );

  if (loadState === 'err') {
    return (
      <div className="page">
        <p className="error">Не удалось загрузить данные: {error}</p>
        <p className="muted">
          Для статики нужен файл <code>data/incidents.json</code> (его создаёт{' '}
          <code>npm run fetch-data</code> перед сборкой). В dev без этого файла приложение один раз
          подгружает данные через прокси Vite. См. README.
        </p>
      </div>
    );
  }

  if (loadState === 'loading' || fetchedAt == null) {
    return (
      <div className="page">
        <p className="muted">Загрузка данных…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">Красные дни Yandex Cloud</h1>
        <p className="tagline">
          График инцидентов, который вы не просили. Каждый красный квадрат — день с инцидентом на{' '}
          <a href="https://status.yandex.cloud/">status.yandex.cloud</a>; чем темнее, тем дольше в этот
          день длилась недоступность по<span className="nowrap"> объединённым интервалам</span>.
        </p>
      </header>

      <section className="geo-filters" aria-label="Зоны доступности">
        <div className="zone-grid">
          {ZONE_OPTIONS.map((z) => (
            <label key={z.id} className="chk zone-chk">
              <input
                type="checkbox"
                checked={pickedZones.includes(z.id)}
                onChange={() => toggleZone(z.id)}
              />
              {z.label}
            </label>
          ))}
        </div>
      </section>

      <section className="stats">
        <p className="stat-main">
          <strong>{summary.downtimeDays.toFixed(1)}</strong> суток суммарного простоя за выбранное окно (
          UTC, последние 365 дней).
        </p>
        <p className="stat-sub muted">
          Дней с простоем по выбранным уровням и зонам: <strong>{summary.daysHit}</strong>
          {summary.worst ? (
            <>
              {' '}
              · худший день{' '}
              <strong>
                {formatDayRu(summary.worst.day)} ({(summary.worst.minutes / 60).toFixed(1)} ч.)
              </strong>
            </>
          ) : null}
        </p>
      </section>

      <section className="filters" aria-label="Уровень инцидента">
        <label className="chk">
          <input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
          Minor
        </label>
        <label className="chk">
          <input
            type="checkbox"
            checked={unavailable}
            onChange={(e) => setUnavailable(e.target.checked)}
          />
          Unavailable
        </label>
      </section>

      <div className="heatmap-wrap">
        <div
          className="heatmap-chart-scroll"
          role="region"
          aria-label="Календарь простоя по неделям, прокрутка по горизонтали"
        >
          <div className="heatmap-chart-scroll-inner">
            <div
              className="month-row"
              style={{
                gridTemplateColumns: `repeat(${weeks}, var(--cell))`,
                columnGap: 'var(--cell-gap)',
              }}
            >
              {monthLabels.map(({ col, label }) => (
                <span key={col} className="month-label" style={{ gridColumnStart: col + 1 }}>
                  {label}
                </span>
              ))}
            </div>

            <div className="heatmap-grid">
              <div className="dow-labels" aria-hidden>
                <span>Вс</span>
                <span>Пн</span>
                <span>Вт</span>
                <span>Ср</span>
                <span>Чт</span>
                <span>Пт</span>
                <span>Сб</span>
              </div>
              <div
                className="weeks"
                style={{
                  gridTemplateColumns: `repeat(${weeks}, var(--cell))`,
                }}
              >
                {cells.map((cell, idx) => {
                  const col = Math.floor(idx / 7);
                  const row = idx % 7;
                  const minutes = cell.inRange
                    ? minutesAffectedOnDay(cell.date, incidents, effectiveLevels)
                    : 0;
                  const b = cell.inRange ? bucketLevel(minutes, colorScale) : 0;
                  const ariaDay = cell.inRange
                    ? `${formatDayRu(cell.date)}, ${formatMinutesShort(minutes)} простоя (объединённые интервалы). Открыть список инцидентов.`
                    : undefined;

                  if (!cell.inRange) {
                    return (
                      <div
                        key={idx}
                        className="cell l0 out-range"
                        style={{ gridColumnStart: col + 1, gridRowStart: row + 1 }}
                        aria-hidden
                      />
                    );
                  }

                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`cell l${b}`}
                      style={{ gridColumnStart: col + 1, gridRowStart: row + 1 }}
                      aria-label={ariaDay}
                      onMouseEnter={(e) =>
                        setHoverTip({ day: new Date(cell.date.getTime()), x: e.clientX, y: e.clientY })
                      }
                      onMouseMove={(e) =>
                        setHoverTip((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : null))
                      }
                      onMouseLeave={() => setHoverTip(null)}
                      onFocus={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHoverTip({
                          day: new Date(cell.date.getTime()),
                          x: r.left + r.width / 2,
                          y: r.bottom + 4,
                        });
                      }}
                      onBlur={() => setHoverTip(null)}
                      onClick={() => {
                        setSelectedDay(new Date(cell.date.getTime()));
                        setHoverTip(null);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="legend">
          <span className="muted">Меньше</span>
          <div className="legend-cells">
            <div className="cell l0 le" />
            <div className="cell l1 le" />
            <div className="cell l2 le" />
            <div className="cell l3 le" />
            <div className="cell l4 le" />
          </div>
          <span className="muted">Больше</span>
        </div>
      </div>

      {hoverTip ? (
        <div
          className="heat-tooltip"
          style={{ left: hoverTip.x + 14, top: hoverTip.y + 14 }}
          role="tooltip"
        >
          <div className="heat-tooltip-date">{formatDayRu(hoverTip.day)}</div>
          <div className="heat-tooltip-sub muted">
            Объединённый простой:{' '}
            {formatMinutesShort(minutesAffectedOnDay(hoverTip.day, incidents, effectiveLevels))}
          </div>
          {hoverRows.length === 0 ? (
            <p className="heat-tooltip-empty muted">Нет инцидентов с выбранными уровнями.</p>
          ) : (
            <ul className="heat-tooltip-list">
              {hoverRows.slice(0, TOOLTIP_MAX).map(({ incident, minutesOnDay }) => (
                <li key={incident.id}>
                  <span className="heat-tooltip-min">{formatMinutesShort(minutesOnDay)}</span>
                  <span className="heat-tooltip-title">{incident.t}</span>
                  <span className="muted heat-tooltip-lvl">{levelLabel(incident.l)}</span>
                </li>
              ))}
            </ul>
          )}
          {hoverRows.length > TOOLTIP_MAX ? (
            <p className="heat-tooltip-more muted">Ещё {hoverRows.length - TOOLTIP_MAX}… клик для полного списка</p>
          ) : hoverRows.length > 0 ? (
            <p className="heat-tooltip-more muted">Клик — подробнее и ссылки</p>
          ) : null}
        </div>
      ) : null}

      {selectedDay ? (
        <div className="day-modal-root">
          <div
            className="day-modal-backdrop"
            role="presentation"
            onClick={() => setSelectedDay(null)}
          />
          <div
            className="day-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="day-modal-title"
          >
            <div className="day-modal-head">
              <h2 id="day-modal-title" className="day-modal-title">
                {formatDayRu(selectedDay)}
              </h2>
              <button type="button" className="day-modal-close" onClick={() => setSelectedDay(null)}>
                Закрыть
              </button>
            </div>
            <p className="muted day-modal-summary">
              Объединённый простой за день (UTC):{' '}
              <strong>
                {formatMinutesShort(minutesAffectedOnDay(selectedDay, incidents, effectiveLevels))}
              </strong>
              . Ниже — вклад отдельных инцидентов с учётом уровней Minor / Unavailable.
            </p>
            {selectedRows.length === 0 ? (
              <p className="muted">За этот день нет инцидентов с текущими фильтрами уровня.</p>
            ) : (
              <ul className="day-modal-list">
                {selectedRows.map(({ incident, minutesOnDay }) => (
                  <li key={incident.id} className="day-modal-item">
                    <div className="day-modal-item-top">
                      <span className="day-modal-min">{formatMinutesShort(minutesOnDay)} в этот день</span>
                      <span className="muted">{levelLabel(incident.l)}</span>
                    </div>
                    <div className="day-modal-item-title">{incident.t}</div>
                    {incident.region ? (
                      <p className="muted day-modal-region">{incident.region}</p>
                    ) : null}
                    <a className="day-modal-link" href={incident.u} target="_blank" rel="noopener noreferrer">
                      Карточка инцидента →
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <footer className="footer">
        <p>
          Неофициальная пародия на график GitHub Status https://red-squares.cian.lol/. Снимок инцидентов берётся из{' '}
          <code>data/incidents.json</code>, который при деплое собирается из{' '}
          <code>status.yandex.cloud/api/incidents</code> (см.{' '}
          <a href="https://github.com/essentialkaos/ycs">essentialkaos/ycs</a>). Интервалы с перепутанными
          метками начала/конца нормализуются по минимуму/максимуму времени. Насыщенность цвета считается от
          95-го перцентиля дневных минут простоя (редкий выброс не «забивает» всю шкалу). Технические работы и
          прочие инциденты из API учитываются без дополнительной фильтрации. Часовой пояс агрегации — UTC.
          Фильтр по зонам на клиенте — по полям ответа API (частично эвристика, см. код).
        </p>
        <p className="muted meta">
          Загружено: {new Date(fetchedAt).toLocaleString('ru-RU')} · инцидентов в наборе: {incidents.length}
          {allZonesSelected
            ? ' · все зоны'
            : ` · зоны: ${[...pickedZones].sort().join(', ')}`}
        </p>
      </footer>
    </div>
  );
}
