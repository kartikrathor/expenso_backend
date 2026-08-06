export type AssistantDateRange = {
  start: string;
  end: string;
  labelEn: string;
  labelHi: string;
  kind: 'month' | 'week' | 'days' | 'range';
};

const MONTHS: Array<{ month: number; names: string[]; label: string }> = [
  { month: 1, names: ['january', 'jan', 'janvari', 'janwari'], label: 'January' },
  { month: 2, names: ['february', 'feb', 'farvari', 'februari'], label: 'February' },
  { month: 3, names: ['march', 'mar'], label: 'March' },
  { month: 4, names: ['april', 'apr'], label: 'April' },
  { month: 5, names: ['may'], label: 'May' },
  { month: 6, names: ['june', 'jun'], label: 'June' },
  { month: 7, names: ['july', 'jul'], label: 'July' },
  { month: 8, names: ['august', 'aug'], label: 'August' },
  { month: 9, names: ['september', 'sep', 'sept'], label: 'September' },
  { month: 10, names: ['october', 'oct'], label: 'October' },
  { month: 11, names: ['november', 'nov'], label: 'November' },
  { month: 12, names: ['december', 'dec'], label: 'December' },
];

function validDateKey(raw?: string): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

function fromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(key: string, days: number): string {
  const date = fromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return toKey(date);
}

function monthRange(year: number, month: number, label: string): AssistantDateRange {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  return {
    start,
    end: toKey(endDate),
    labelEn: `${label} ${year}`,
    labelHi: `${label} ${year}`,
    kind: 'month',
  };
}

function monthInfo(token: string) {
  const normalized = token.toLowerCase();
  return MONTHS.find(info => info.names.includes(normalized));
}

function weekRange(today: string, previous: boolean): AssistantDateRange {
  const date = fromKey(today);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addDays(today, mondayOffset + (previous ? -7 : 0));
  const end = addDays(start, 6);
  return {
    start,
    end,
    labelEn: previous ? 'last week' : 'this week',
    labelHi: previous ? 'pichle week' : 'is week',
    kind: 'week',
  };
}

/**
 * Understand calendar periods before generic intent matching. A date range is
 * deliberately date-only; filtering later applies the client's timezone.
 */
export function detectAssistantDateRange(
  raw: string,
  clientToday?: string,
): AssistantDateRange | null {
  const text = (raw || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const today = validDateKey(clientToday);
  const todayDate = fromKey(today);
  const year = todayDate.getUTCFullYear();
  const currentMonth = todayDate.getUTCMonth() + 1;

  if (/\b(last|previous)\s+month\b|\bpich(?:hla|le)\s+mahin(?:a|e)\b|\bpichle\s+month\b/.test(text)) {
    const month = currentMonth === 1 ? 12 : currentMonth - 1;
    const targetYear = currentMonth === 1 ? year - 1 : year;
    return monthRange(targetYear, month, MONTHS[month - 1].label);
  }

  if (/\b(last|previous)\s+week\b|\bpich(?:hla|le)\s+haft(?:a|e)\b|\bpichle\s+week\b/.test(text)) {
    return weekRange(today, true);
  }

  const daysMatch = text.match(
    /\b(?:last|past|pichle|pichhle)\s+(\d{1,3})\s+(?:days?|din)\b/,
  );
  if (daysMatch) {
    const days = Math.max(1, Math.min(366, Number(daysMatch[1])));
    return {
      start: addDays(today, -(days - 1)),
      end: today,
      labelEn: `last ${days} days`,
      labelHi: `pichle ${days} din`,
      kind: 'days',
    };
  }

  if (/\bthis\s+week\b|\bis\s+haft(?:a|e)\b|\bis\s+week\b/.test(text)) {
    return weekRange(today, false);
  }

  if (/\bthis\s+month\b|\bcurrent\s+month\b|\bis\s+mahin(?:a|e)\b|\bis\s+month\b/.test(text)) {
    return monthRange(year, currentMonth, MONTHS[currentMonth - 1].label);
  }

  const monthToken = MONTHS.flatMap(info => info.names).join('|');
  const fullRange = text.match(
    new RegExp(
      `\\b(\\d{1,2})\\s*(${monthToken})(?:\\s+(20\\d{2}))?\\s*(?:se|to|through|-)\\s*(\\d{1,2})\\s*(${monthToken})?(?:\\s+(20\\d{2}))?\\b`,
      'i',
    ),
  );
  if (fullRange) {
    const startMonth = monthInfo(fullRange[2]);
    const endMonth = monthInfo(fullRange[5] || fullRange[2]);
    const startYear = Number(fullRange[3] || year);
    const endYear = Number(fullRange[6] || fullRange[3] || year);
    const startDay = Number(fullRange[1]);
    const endDay = Number(fullRange[4]);
    if (startMonth && endMonth && startDay >= 1 && endDay >= 1) {
      const start = `${startYear}-${String(startMonth.month).padStart(2, '0')}-${String(
        startDay,
      ).padStart(2, '0')}`;
      const end = `${endYear}-${String(endMonth.month).padStart(2, '0')}-${String(
        endDay,
      ).padStart(2, '0')}`;
      if (start <= end) {
        const label = `${startDay} ${startMonth.label}–${endDay} ${endMonth.label} ${endYear}`;
        return { start, end, labelEn: label, labelHi: label, kind: 'range' };
      }
    }
  }

  for (const info of MONTHS) {
    const names = info.names.join('|');
    const monthRegex = new RegExp(`\\b(?:${names})\\b`, 'i');
    if (!monthRegex.test(text)) continue;
    // Day + month belongs to the existing specific-date parser.
    if (new RegExp(`\\b\\d{1,2}\\s*(?:${names})\\b|\\b(?:${names})\\s*\\d{1,2}\\b`, 'i').test(text)) {
      return null;
    }
    const explicitYear = text.match(new RegExp(`\\b(?:${names})\\s+(20\\d{2})\\b`, 'i'));
    const targetYear = explicitYear
      ? Number(explicitYear[1])
      : info.month > currentMonth
        ? year - 1
        : year;
    return monthRange(targetYear, info.month, info.label);
  }

  return null;
}

export function expenseInAssistantRange(
  expenseDate: string,
  range: AssistantDateRange,
  timezoneOffsetMinutes = 0,
): boolean {
  const timestamp = new Date(expenseDate).getTime();
  if (Number.isNaN(timestamp)) return false;
  const localTimestamp = timestamp - timezoneOffsetMinutes * 60_000;
  const key = new Date(localTimestamp).toISOString().slice(0, 10);
  return key >= range.start && key <= range.end;
}
