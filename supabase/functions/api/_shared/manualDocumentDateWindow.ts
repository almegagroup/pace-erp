import { todayIsoInKolkata } from "./dateUtils.ts";

export const MANUAL_DOCUMENT_DATE_WINDOW_MONTHS = 3;

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

export function isManualDocumentDateWithinWindow(value: string): boolean {
  const selected = parseIsoDate(value);
  const today = parseIsoDate(todayIsoInKolkata());
  if (!selected || !today) return false;
  const lower = addCalendarMonths(today, -MANUAL_DOCUMENT_DATE_WINDOW_MONTHS);
  const upper = addCalendarMonths(today, MANUAL_DOCUMENT_DATE_WINDOW_MONTHS);
  return selected >= lower && selected <= upper;
}

export const MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE = "Date must be within three calendar months before or after today.";

export function isManualDocumentDateWithinPastWindow(value: string): boolean {
  const selected = parseIsoDate(value);
  const today = parseIsoDate(todayIsoInKolkata());
  if (!selected || !today) return false;
  return selected >= addCalendarMonths(today, -MANUAL_DOCUMENT_DATE_WINDOW_MONTHS) && selected <= today;
}

export const MANUAL_PAST_DATE_WINDOW_MESSAGE = "Date must be within the previous three calendar months and cannot be in the future.";
