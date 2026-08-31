export const MANUAL_DOCUMENT_DATE_WINDOW_MONTHS = 3;

function addCalendarMonths(date, months) {
  const targetYear = date.getFullYear() + Math.floor((date.getMonth() + months) / 12);
  const targetMonth = ((date.getMonth() + months) % 12 + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDay));
}

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getManualDocumentDateBounds(today = new Date()) {
  return {
    min: toLocalIsoDate(addCalendarMonths(today, -MANUAL_DOCUMENT_DATE_WINDOW_MONTHS)),
    max: toLocalIsoDate(addCalendarMonths(today, MANUAL_DOCUMENT_DATE_WINDOW_MONTHS)),
  };
}

export function isManualDocumentDateWithinWindow(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const bounds = getManualDocumentDateBounds(today);
  return value >= bounds.min && value <= bounds.max;
}

export const MANUAL_DOCUMENT_DATE_WINDOW_MESSAGE = "Date must be within three calendar months before or after today.";

export function getManualPastDateBounds(today = new Date()) {
  return {
    min: toLocalIsoDate(addCalendarMonths(today, -MANUAL_DOCUMENT_DATE_WINDOW_MONTHS)),
    max: toLocalIsoDate(today),
  };
}

export function isManualDocumentDateWithinPastWindow(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const bounds = getManualPastDateBounds(today);
  return value >= bounds.min && value <= bounds.max;
}

export const MANUAL_PAST_DATE_WINDOW_MESSAGE = "Date must be within the previous three calendar months and cannot be in the future.";
