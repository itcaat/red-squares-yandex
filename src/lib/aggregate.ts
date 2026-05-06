export type SlimIncident = {
  id: number;
  t: string;
  s: number;
  e: number;
  l: number;
  open?: boolean;
  u: string;
  /** Регионы и зоны из API (installations), строка для UI */
  region?: string;
};

function mergeIntervalsMs(intervals: [number, number][]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur[0] <= prev[1]) prev[1] = Math.max(prev[1], cur[1]);
    else merged.push(cur);
  }
  return merged.reduce((acc, [a, b]) => acc + (b - a), 0);
}

/** UTC midnight for calendar date components */
export function utcMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export function utcDayBounds(day: Date): { start: number; end: number } {
  const s = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0);
  const e = s + 86400000;
  return { start: s, end: e };
}

export type DayIncidentOverlap = {
  incident: SlimIncident;
  /** Длительность пересечения инцидента с этим календарным днём (UTC), минуты */
  minutesOnDay: number;
};

/** Инциденты, которые попадают на этот день с учётом выбранных уровней (до объединения интервалов). */
export function incidentsTouchingDay(
  day: Date,
  incidents: SlimIncident[],
  levels: Set<number>,
): DayIncidentOverlap[] {
  const { start: ds, end: de } = utcDayBounds(day);
  const rows: DayIncidentOverlap[] = [];
  for (const inc of incidents) {
    if (!levels.has(inc.l)) continue;
    const s = Math.max(inc.s, ds);
    const e = Math.min(inc.e, de);
    if (e <= s) continue;
    rows.push({ incident: inc, minutesOnDay: (e - s) / 60000 });
  }
  rows.sort((a, b) => b.minutesOnDay - a.minutesOnDay || a.incident.id - b.incident.id);
  return rows;
}

export function minutesAffectedOnDay(
  day: Date,
  incidents: SlimIncident[],
  levels: Set<number>,
): number {
  const { start: ds, end: de } = utcDayBounds(day);
  const intervals: [number, number][] = [];
  for (const inc of incidents) {
    if (!levels.has(inc.l)) continue;
    const s = Math.max(inc.s, ds);
    const e = Math.min(inc.e, de);
    if (e > s) intervals.push([s, e]);
  }
  return mergeIntervalsMs(intervals) / 60000;
}

export function sumDowntimeDays(
  incidents: SlimIncident[],
  levels: Set<number>,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  let totalMin = 0;
  const cursor = new Date(rangeStart.getTime());
  const end = rangeEnd.getTime();
  while (cursor.getTime() <= end) {
    totalMin += minutesAffectedOnDay(cursor, incidents, levels);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return totalMin / 60 / 24;
}

export function countDaysWithIncidents(
  incidents: SlimIncident[],
  levels: Set<number>,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  let n = 0;
  const cursor = new Date(rangeStart.getTime());
  const end = rangeEnd.getTime();
  while (cursor.getTime() <= end) {
    if (minutesAffectedOnDay(cursor, incidents, levels) > 0) n += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return n;
}

export function findWorstDay(
  incidents: SlimIncident[],
  levels: Set<number>,
  rangeStart: Date,
  rangeEnd: Date,
): { day: Date; minutes: number } | null {
  let best: { day: Date; minutes: number } | null = null;
  const cursor = new Date(rangeStart.getTime());
  const end = rangeEnd.getTime();
  while (cursor.getTime() <= end) {
    const m = minutesAffectedOnDay(cursor, incidents, levels);
    if (!best || m > best.minutes) best = { day: new Date(cursor.getTime()), minutes: m };
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (!best || best.minutes <= 0) return null;
  return best;
}
