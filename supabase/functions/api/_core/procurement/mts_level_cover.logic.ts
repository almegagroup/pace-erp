/**
 * PO22 report: a family level has a day record only on the days something happens to IT.
 * An order that feeds another level leaves no record for this one that day — the report used to show a blank
 * (owner 2026-11-18). Between two records nothing changes for the level except one day of use per day, so the
 * state on any date is the latest record up to that date, carried forward by the quiet days in between.
 */
export interface LevelDayRecord { day: string; levels: ReadonlyArray<{ level_key: string }> }

const DAY_MS = 86_400_000;

export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function addDaysToIso(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The latest day record for the level on or before `date`, and how many quiet days lie after it. */
export function levelRecordUpTo<D extends LevelDayRecord>(days: readonly D[], levelKey: string, date: string | null): { record: D; gap: number } | null {
  if (!date) return null;
  let best: D | null = null;
  for (const d of days) {
    if (d.day <= date && d.levels.some((l) => l.level_key === levelKey) && (best === null || d.day > best.day)) best = d;
  }
  return best ? { record: best, gap: daysBetweenIso(best.day, date) } : null;
}

/** Whole days of cover carried over `gap` quiet days; never below zero, null stays null. */
export function carryCover(cover: number | null | undefined, gap: number): number | null {
  if (cover === null || cover === undefined) return null;
  return Math.max(0, cover - Math.max(0, gap));
}
