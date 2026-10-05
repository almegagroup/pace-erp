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
