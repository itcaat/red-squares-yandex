/** Sunday-first week; GitHub-style grid columns = weeks, rows = weekday */
export type HeatCell = {
  date: Date;
  inRange: boolean;
};

export function startOfUtcWeekSunday(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = x.getUTCDay();
  x.setUTCDate(x.getUTCDate() - wd);
  return x;
}

export function buildHeatGrid(rangeStart: Date, rangeEnd: Date): {
  weeks: number;
  gridStartSunday: Date;
  cells: HeatCell[];
} {
  const gridStartSunday = startOfUtcWeekSunday(rangeStart);
  const rs = rangeStart.getTime();
  const re = rangeEnd.getTime();
  const daysSpan = Math.floor((re - gridStartSunday.getTime()) / 86400000) + 1;
  const weeks = Math.max(1, Math.ceil(daysSpan / 7));
  const totalCells = weeks * 7;

  const cells: HeatCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(gridStartSunday.getTime());
    date.setUTCDate(date.getUTCDate() + i);
    const t = date.getTime();
    const inRange = t >= rs && t <= re;
    cells.push({ date, inRange });
  }

  return { weeks, gridStartSunday, cells };
}

export function monthLabelsForGrid(
  gridStartSunday: Date,
  weeks: number,
): { col: number; label: string }[] {
  const labels: { col: number; label: string }[] = [];
  let last = '';
  for (let col = 0; col < weeks; col++) {
    const d = new Date(gridStartSunday.getTime());
    d.setUTCDate(d.getUTCDate() + col * 7 + 3);
    const name = d.toLocaleString('ru-RU', { month: 'short', timeZone: 'UTC' });
    const label = name.replace('.', '');
    if (label !== last) {
      labels.push({ col, label });
      last = label;
    }
  }
  return labels;
}
