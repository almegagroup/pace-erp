/*
 * File-Path: frontend/src/utils/numberToWordsIndian.js
 * Purpose: Convert a rupee amount to words using the Indian numbering system
 *          (Lakh/Crore, not Million/Billion) — display-only, never stored
 *          (§133.8-I "Amount in Words" — feasibility doc, SO01 Page 2 footer).
 * Authority: Frontend
 */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitsToWords(value) {
  if (value === 0) return "";
  if (value < 20) return ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${TENS[tens]}${ones ? ` ${ONES[ones]}` : ""}`;
}

function threeDigitsToWords(value) {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigitsToWords(rest));
  return parts.join(" ");
}

// Indian grouping: last 3 digits, then groups of 2 (Thousand, Lakh, Crore, ...).
function integerToWordsIndian(value) {
  if (value === 0) return "Zero";
  const segments = [];
  let remaining = value;
  segments.push(remaining % 1000);
  remaining = Math.floor(remaining / 1000);
  const groupLabels = ["Thousand", "Lakh", "Crore", "Arab", "Kharab"];
  while (remaining > 0) {
    segments.push(remaining % 100);
    remaining = Math.floor(remaining / 100);
  }

  const parts = [];
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (!segment) continue;
    const words = i === 0 ? threeDigitsToWords(segment) : twoDigitsToWords(segment);
    if (!words) continue;
    const label = i > 0 ? groupLabels[i - 1] : "";
    parts.push(label ? `${words} ${label}` : words);
  }
  return parts.join(" ");
}

// Amount to words: "Rupees <X> and Paise <Y> Only" (paise omitted if zero).
export function amountToWordsIndian(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(Math.abs(numeric) * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  const sign = numeric < 0 ? "Minus " : "";
  const rupeeWords = integerToWordsIndian(rupees);
  const paiseWords = paise > 0 ? ` and Paise ${twoDigitsToWords(paise)}` : "";
  return `${sign}Rupees ${rupeeWords}${paiseWords} Only`;
}
