export const REDIRECT_TIPS = Object.freeze([
  "Protect access with strong passwords and never reuse ERP credentials across personal services.",
  "Review shared reports carefully and remove unneeded exports from email threads and downloads.",
  "Lock your workspace before stepping away so operational data stays protected from shoulder surfing.",
  "Download only the files you need, and delete outdated local copies after approved use is complete.",
  "Check recipient names twice before sharing finance, payroll, costing, or supplier data.",
  "Keep master data clean by updating records at the source instead of maintaining side spreadsheets.",
  "Treat customer, employee, and vendor data as confidential even inside internal chat groups.",
  "Use the ERP as the single source of truth so teams do not make decisions from stale copied data.",
  "Report suspicious logins, unusual exports, or unexpected permission changes as soon as they are noticed.",
  "Good data hygiene starts with small habits: accurate entry, timely updates, and careful access control.",
]);

export function shuffleRedirectTips(seedItems = REDIRECT_TIPS) {
  const items = [...seedItems];

  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

export function pickRandomRedirectTip(seedItems = REDIRECT_TIPS) {
  const items = seedItems.length > 0 ? seedItems : REDIRECT_TIPS;
  return items[Math.floor(Math.random() * items.length)];
}
