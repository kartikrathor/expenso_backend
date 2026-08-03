import { ExpenseInput, formatINR } from './stats';

/** Soft normalize for matching (same spirit as engine soften/normalize). */
function norm(msg: string): string {
  return msg
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s./-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function soften(s: string): string {
  return s
    .replace(/kharcha|kharche|kharchu/g, 'kharch')
    .replace(/\bkitne\b/g, 'kitna')
    .replace(/\bkitni\b/g, 'kitna')
    .replace(/\bbheje\b/g, 'bhej')
    .replace(/\bbheja\b/g, 'bhej')
    .replace(/\bsent\b/g, 'send')
    .replace(/\bpaid\b/g, 'pay')
    .replace(/\btransferred\b/g, 'transfer')
    .replace(/\babtk\b/g, 'ab tak')
    .replace(/\btarikh\b/g, 'date');
}

export const TRANSFER_STEMS = [
  'ko send',
  'ko bhej',
  'ko diye',
  'ko diya',
  'ko transfer',
  'send kiye',
  'send kiya',
  'bhej diye',
  'bhej diya',
  'transfer kiye',
  'transfer kiya',
  'kitna send',
  'kitne send',
  'kitna bhej',
  'kitne bhej',
  'kitna transfer',
  'send to',
  'pay to',
  'paid to',
  'transfer to',
  'money to',
  'paisa bhej',
  'paisa send',
  'rs bhej',
  'rs send',
  'rupees to',
];

export const ON_DATE_STEMS = [
  'is date',
  'us date',
  'us din',
  'usi din',
  'that day',
  'on that day',
  'tarikh ko',
  'date ko',
  'din kitna',
  'spending on',
  'spent on',
  'expenses on',
  'kharch on',
  'kisi date',
];

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  janvari: 0,
  feb: 1,
  february: 1,
  farvari: 1,
  mar: 2,
  march: 2,
  april: 3,
  apr: 3,
  may: 4,
  mai: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  agast: 7,
  agustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
  disambar: 11,
};

export type CalendarDay = {
  y: number;
  m: number; // 0-11
  d: number;
  label: string;
};

export type MerchantMatch = {
  query: string;
  matchedLabel: string;
};

const STOP_NAME = new Set([
  'kitna', 'kitne', 'rs', 'rupees', 'rupee', 'send', 'bhej', 'diye', 'diya',
  'kiye', 'kiya', 'transfer', 'pay', 'paid', 'money', 'paisa', 'total',
  'ab', 'tak', 'this', 'month', 'week', 'year', 'today', 'aaj', 'maine',
  'mene', 'main', 'i', 'me', 'my', 'the', 'ko', 'pe', 'par', 'se', 'and',
  'for', 'all', 'overall', 'hai', 'tha', 'thi', 'hua', 'huye', 'is',
  'mahine', 'mahina', 'date', 'tarikh', 'din', 'kal', 'parson',
]);

function looksLikeDateToken(name: string): boolean {
  const n = name.toLowerCase().trim();
  if (!n) return true;
  if (/\d/.test(n)) return true;
  if (Object.keys(MONTH_MAP).some(m => n === m || n.split(/\s+/).includes(m))) return true;
  if (/\b(date|tarikh|din|yesterday|kal)\b/.test(n)) return true;
  return false;
}

function cleanPersonName(raw: string): string | null {
  const name = raw
    .replace(
      /\b(kitna|send|bhej|diye|diya|kiye|kiya|transfer|rs|rupees|total|ab tak|this month|is month|overall|hua)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w && !STOP_NAME.has(w))
    .join(' ')
    .trim();
  if (name.length < 2 || name.length > 40) return null;
  if (looksLikeDateToken(name)) return null;
  return name;
}

function labelFor(y: number, m: number, d: number): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${d} ${months[m]} ${y}`;
}

function makeDay(y: number, m: number, d: number): CalendarDay | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const dt = new Date(y, m, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
  return { y, m, d, label: labelFor(y, m, d) };
}

/** Parse a concrete calendar day from the user message. */
export function detectCalendarDate(raw: string, now = new Date()): CalendarDay | null {
  const t = soften(norm(raw));

  if (/\b(kal|yesterday)\b/.test(t) && !/\baaj\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return makeDay(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (/\b(parson|day before yesterday|parsoun)\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    return makeDay(d.getFullYear(), d.getMonth(), d.getDate());
  }

  {
    const m = t.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
    if (m) {
      const day = makeDay(+m[1], +m[2] - 1, +m[3]);
      if (day) return day;
    }
  }

  {
    const m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](20\d{2}|\d{2}))?\b/);
    if (m) {
      const d = +m[1];
      const mo = +m[2] - 1;
      let y = m[3] ? +m[3] : now.getFullYear();
      if (y < 100) y += 2000;
      const day = makeDay(y, mo, d);
      if (day) return day;
    }
  }

  {
    const monthNames = Object.keys(MONTH_MAP).join('|');
    const re1 = new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})(?:\\s+(20\\d{2}))?\\b`,
    );
    const m1 = t.match(re1);
    if (m1) {
      const day = makeDay(m1[3] ? +m1[3] : now.getFullYear(), MONTH_MAP[m1[2]], +m1[1]);
      if (day) return day;
    }
    const re2 = new RegExp(
      `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(20\\d{2}))?\\b`,
    );
    const m2 = t.match(re2);
    if (m2) {
      const day = makeDay(m2[3] ? +m2[3] : now.getFullYear(), MONTH_MAP[m2[1]], +m2[2]);
      if (day) return day;
    }
  }

  {
    const m = t.match(/\b(\d{1,2})\s*(?:date|tarikh)\b/);
    if (m) {
      const day = makeDay(now.getFullYear(), now.getMonth(), +m[1]);
      if (day) return day;
    }
  }

  return null;
}

/** Pull a person/merchant hint from phrasing like “maine Rahul ko…”. */
export function extractPersonHint(raw: string): string | null {
  const t = soften(norm(raw));
  const patterns: RegExp[] = [
    /\b(?:maine|mene|i)\s+(.+?)\s+ko\b/,
    /\b([a-z\u0900-\u097f][a-z0-9\u0900-\u097f.]{1,30}?)\s+ko\s+(?:(?:ab tak|is month|this month|aaj|today|overall)\s+)*(?:kitna|send|bhej|diye|diya|transfer|rs|rupees)/,
    /\b(?:send|pay|transfer|bhej)\s+(?:to\s+)?(.+?)(?:\s+(?:kitna|rs|rupees|total|ab|this|is|all|month|week|year|today|aaj)|$)/,
    /\b(?:to)\s+([a-z\u0900-\u097f][a-z0-9\u0900-\u097f .]{1,30}?)(?:\s+(?:kitna|total|this|all|ab|month)|$)/,
    /\bhow much (?:did i |have i )?(?:send|sent|pay|paid|transfer)(?:ed)? to\s+(.+?)(?:\s+(?:this|all|ab|in|on)|$)/,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const name = cleanPersonName(m[1]);
    if (name) return name;
  }
  return null;
}

/** True if message looks like “sent/paid to someone”. */
export function isTransferQuestion(raw: string): boolean {
  const t = soften(norm(raw));
  if (TRANSFER_STEMS.some(s => t.includes(s))) return true;

  const hint = extractPersonHint(raw);
  if (!hint) return false;

  if (
    /\b(maine|mene|i)\s+\S.+\s+ko\b/.test(t) &&
    /\b(kitna|send|bhej|diye|diya|transfer|rs)\b/.test(t)
  ) {
    return true;
  }

  if (/\b(send|bhej|transfer|diye|diya|pay)\b/.test(t)) return true;

  // “Rahul ko kitna” / “Rahul ko ab tak kitna” / “Rahul ko is month kitna”
  if (/\bko\s+(?:(?:ab tak|is month|this month|aaj|today|overall)\s+)?kitna\b/.test(t)) {
    return true;
  }

  return false;
}

/** True if message asks about a specific calendar day (not just “aaj”). */
export function isOnDateQuestion(raw: string): boolean {
  if (isTransferQuestion(raw)) return false;

  const t = soften(norm(raw));
  if (ON_DATE_STEMS.some(s => t.includes(s))) return true;
  if (/\b(kal|yesterday|parson)\b/.test(t) && /\b(kitna|kharch|spent|spend|hua)\b/.test(t)) {
    return true;
  }
  if (detectCalendarDate(raw) && /\b(kitna|kharch|spent|spend|hua|total|expenses?)\b/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Match a person/merchant against expense merchantLabel + short notes.
 * Prefers longest substring hit; falls back to extracted name even if no expense yet.
 */
export function detectMerchantFromExpenses(
  raw: string,
  expenses: ExpenseInput[],
): MerchantMatch | null {
  const t = soften(norm(raw));
  const candidates = new Map<string, string>();

  for (const e of expenses) {
    const label = (e.merchantLabel || '').trim();
    if (
      label.length >= 2 &&
      !['unknown', 'default', 'other', 'misc'].includes(label.toLowerCase())
    ) {
      candidates.set(label.toLowerCase(), label);
    }
    const note = (e.note || '').trim();
    if (note.length >= 2 && note.length <= 48) {
      const chunk = note.split(/[,|\-–—]/)[0].trim();
      if (chunk.length >= 2 && chunk.length <= 40 && !looksLikeDateToken(chunk)) {
        candidates.set(chunk.toLowerCase(), chunk);
      }
    }
  }

  let best: { label: string; score: number } | null = null;
  for (const [lower, display] of candidates) {
    if (lower.length < 2) continue;
    if (t.includes(lower)) {
      const score = lower.length + 50;
      if (!best || score > best.score) best = { label: display, score };
    }
  }

  const hint = extractPersonHint(raw);
  if (hint) {
    const hl = hint.toLowerCase();
    for (const [lower, display] of candidates) {
      if (lower === hl || lower.includes(hl) || hl.includes(lower)) {
        const score = Math.min(lower.length, hl.length) + 120;
        if (!best || score > best.score) best = { label: display, score };
      }
    }
    if (!best) {
      return { query: hint, matchedLabel: hint };
    }
  }

  return best ? { query: best.label, matchedLabel: best.label } : null;
}

export function expenseOnDay(e: ExpenseInput, day: CalendarDay): boolean {
  const dt = new Date(e.date);
  if (Number.isNaN(dt.getTime())) return false;
  return (
    dt.getFullYear() === day.y && dt.getMonth() === day.m && dt.getDate() === day.d
  );
}

export function expenseMatchesMerchant(e: ExpenseInput, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  const label = (e.merchantLabel || '').toLowerCase();
  const note = (e.note || '').toLowerCase();
  return label.includes(q) || note.includes(q) || (label.length >= 2 && q.includes(label));
}

export function formatMerchantReply(opts: {
  label: string;
  periodLabel: string;
  amount: number;
  count: number;
  biggest: ExpenseInput | null;
  dateLabel?: string | null;
}): string {
  const scope = opts.dateLabel || opts.periodLabel;
  if (opts.count === 0) {
    return opts.dateLabel
      ? `${opts.dateLabel} pe “${opts.label}” ka koi transfer/expense nahi mila.`
      : `${scope} “${opts.label}” ko/pe koi transfer nahi mila. Merchant label ya note me naam check karo.`;
  }
  const big = opts.biggest
    ? ` Biggest: ${opts.biggest.merchantLabel} (${formatINR(opts.biggest.amount)}).`
    : '';
  return `${scope} “${opts.label}” ko/pe ${formatINR(opts.amount)} gaya (${opts.count} entries).${big}`;
}

export function formatDateReply(opts: {
  dateLabel: string;
  amount: number;
  count: number;
  biggest: ExpenseInput | null;
  topMerchant: string | null;
}): string {
  if (opts.count === 0) {
    return `${opts.dateLabel} ko koi expense nahi mila.`;
  }
  const big = opts.biggest
    ? ` Biggest: ${opts.biggest.merchantLabel} (${formatINR(opts.biggest.amount)}).`
    : '';
  const top = opts.topMerchant ? ` Top: ${opts.topMerchant}.` : '';
  return `${opts.dateLabel} total: ${formatINR(opts.amount)} (${opts.count} transactions).${big}${top}`;
}
