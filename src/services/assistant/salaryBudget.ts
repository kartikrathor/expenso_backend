import { formatINR } from './stats';

/**
 * Pull a salary / income amount from free text.
 * Supports: 50000, 50,000, 50k, 1.2 lakh, 1.5L
 */
export function extractMoneyAmount(text: string): number | null {
  const t = (text || '').toLowerCase().replace(/,/g, '');
  if (!t.trim()) return null;

  const lakh = t.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|lakhs|lacs|\bl\b)/i);
  if (lakh) {
    const n = Number(lakh[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100000);
  }

  const k = t.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (k) {
    const n = Number(k[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }

  // Prefer amount near salary/income/earn words
  const near = t.match(
    /(?:salary|salry|income|earn|kamata|kamati|paycheck|ctc|inhand|in-hand|take home|takehome)[^\d]{0,20}(\d{4,9})/i,
  );
  if (near) {
    const n = Number(near[1]);
    if (Number.isFinite(n) && n >= 1000) return n;
  }

  const nearAfter = t.match(
    /(\d{4,9})[^\d]{0,12}(?:salary|salry|income|hai|rupees|rs|inr)/i,
  );
  if (nearAfter) {
    const n = Number(nearAfter[1]);
    if (Number.isFinite(n) && n >= 1000) return n;
  }

  // Fallback: largest 4–9 digit number in the message
  const nums = [...t.matchAll(/\b(\d{4,9})\b/g)].map(m => Number(m[1])).filter(n => n >= 1000);
  if (nums.length) return Math.max(...nums);
  return null;
}

export function isSalaryBudgetQuestion(text: string): boolean {
  const t = (text || '').toLowerCase();
  const hasSalary = /salary|salry|income|paycheck|ctc|inhand|in-hand|take\s*home|kamata|kamati|earn/.test(
    t,
  );
  const hasBudgetAsk =
    /budget|kitna hona|kitna rakh|kitna set|should be|hona chahiye|rakhu|rakhna|recommend|suggest|ideal/.test(
      t,
    );
  // "salary 50k" alone also counts as asking what budget fits
  if (hasSalary && (hasBudgetAsk || extractMoneyAmount(t) != null)) return true;
  if (hasBudgetAsk && /hona chahiye|should (my )?budget|ideal budget|recommended budget/.test(t)) {
    return true;
  }
  return false;
}

/** Classic 50/30/20 style guidance from take-home salary. */
export function buildSalaryBudgetAdvice(salary: number, lang: 'en' | 'hi' = 'en'): string {
  const needs = Math.round(salary * 0.5);
  const wants = Math.round(salary * 0.3);
  const save = Math.round(salary * 0.2);
  const spendBudget = needs + wants; // ~80% living+lifestyle cap many people use as "budget"
  const strict = Math.round(salary * 0.7);

  if (lang === 'hi') {
    return (
      `Salary ${formatINR(salary)} maan ke: ` +
      `monthly expense budget roughly ${formatINR(spendBudget)} (50% needs ${formatINR(needs)} + 30% wants ${formatINR(wants)}), ` +
      `aur ${formatINR(save)} (~20%) save/invest. ` +
      `Tight rakhna ho to Home pe budget ~${formatINR(strict)} set karo. ` +
      `Ye rule-of-thumb hai — rent/EMIs zyada hon to needs % adjust karo.`
    );
  }

  return (
    `With salary ${formatINR(salary)}: a solid monthly spend budget is about ${formatINR(spendBudget)} ` +
    `(50% needs ~${formatINR(needs)}, 30% wants ~${formatINR(wants)}), and save/invest ~${formatINR(save)} (20%). ` +
    `If you want a tighter cap, set Home budget near ${formatINR(strict)}. ` +
    `This is a rule of thumb — raise the needs share if rent/EMIs are high.`
  );
}
