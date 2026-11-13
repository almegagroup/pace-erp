import { todayIsoInIndia } from "./indiaDate.js";

export const MANUAL_DOCUMENT_DATE_WINDOW_MONTHS = 3;

function addCalendarMonths(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = (monthIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function toBusinessIsoDate(date) {
  return todayIsoInIndia(date);
}

export function getManualDocumentDateBounds(today = new Date()) {
  const businessToday = toBusinessIsoDate(today);
  return {
    min: addCalendarMonths(businessToday, -MANUAL_DOCUMENT_DATE_WINDOW_MONTHS),
    max: addCalendarMonths(businessToday, MANUAL_DOCUMENT_DATE_WINDOW_MONTHS),
  };
}

export function isManualDocumentDateWithinWindow(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const bounds = getManualDocumentDateBounds(today);
  return value >= bounds.min && value <= bounds.max;
}

// A date that is exactly the value already stored on the document is never re-checked
// against the window: the window is a typo guard for a date being entered, and a record
// re-opened later (e.g. a Stroke edited to add an alternate group) must keep its genuine
// original date. Any OTHER value -- older or newer -- still has to be inside the window.
// The backend repeats this check against the stored DB value; this only mirrors it for UX.
export function isManualDocumentDateAcceptable(value, storedValue, today = new Date()) {
  const stored = String(storedValue ?? "").slice(0, 10);
  if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) && value === stored) return true;
  return isManualDocumentDateWithinWindow(value, today);
}

export const MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE = "Date must be within three calendar months before or after today.";

export function getManualPastDateBounds(today = new Date()) {
  const businessToday = toBusinessIsoDate(today);
  return {
    min: addCalendarMonths(businessToday, -MANUAL_DOCUMENT_DATE_WINDOW_MONTHS),
    max: businessToday,
  };
}

export function isManualDocumentDateWithinPastWindow(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const bounds = getManualPastDateBounds(today);
  return value >= bounds.min && value <= bounds.max;
}

export const MANUAL_PAST_DATE_WINDOW_MESSAGE = "Date must be within the previous three calendar months and cannot be in the future.";
