export const DASHBOARD_TIMEZONE = 'America/New_York';

export const MONTH_KEYS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

export type MonthKey = (typeof MONTH_KEYS)[number];

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MIN_DASHBOARD_YEAR = 2020;
export const MAX_DASHBOARD_YEAR = 2100;

export function monthKeyToIndex(month: string): number {
  return MONTH_KEYS.indexOf(month.trim().toLowerCase() as MonthKey);
}

export function daysInMonth(monthIndex: number, year: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - instant.getTime();
}

function zonedMidnightToUtc(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, monthIndex, day);
  const firstPass = guess - zoneOffsetMs(new Date(guess), timeZone);
  const offset = zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(guess - offset);
}

export function zonedMonthRange(
  monthIndex: number,
  year: number,
  timeZone: string = DASHBOARD_TIMEZONE,
): { start: Date; end: Date } {
  const start = zonedMidnightToUtc(year, monthIndex, 1, timeZone);

  const nextMonthIndex = monthIndex === 11 ? 0 : monthIndex + 1;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const end = zonedMidnightToUtc(nextYear, nextMonthIndex, 1, timeZone);

  return { start, end };
}

export interface DailyBucketRow {
  _id: string;
  count: number;
}

export function buildDailySeries(
  rows: DailyBucketRow[],
  monthIndex: number,
  year: number,
): Record<string, number> {
  const byDay = new Map<number, number>();

  for (const row of rows) {
    // '2026-06-14' -> 14
    const day = Number(row._id.slice(8, 10));
    if (!Number.isNaN(day)) {
      byDay.set(day, (byDay.get(day) ?? 0) + row.count);
    }
  }

  const monthName = MONTH_NAMES[monthIndex];
  const total = daysInMonth(monthIndex, year);
  const series: Record<string, number> = {};

  for (let day = 1; day <= total; day++) {
    series[`${monthName} ${day}`] = byDay.get(day) ?? 0;
  }

  return series;
}

export function zonedDateKey(
  instant: Date,
  timeZone: string = DASHBOARD_TIMEZONE,
): string {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  return `${parts.year}-${parts.month}-${parts.day}`;
}
