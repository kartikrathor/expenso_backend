import {
  CATEGORY_SYNONYMS,
  PERIOD_SYNONYMS,
  textIncludesAny,
} from './lexicon';
import {
  CalendarDay,
  expenseMatchesMerchant,
  expenseOnDay,
} from './transferDate';
import { AssistantDateRange, expenseInAssistantRange } from './dateRange';
import { MonthlyBudgetEntry, normalizeMonthlyBudgets } from '../monthlyBudgets';

export type ExpenseInput = {
  amount: number;
  merchantLabel: string;
  category: string;
  note?: string;
  date: string;
  createdById?: string;
  createdByName?: string;
  paidById?: string;
  paidByName?: string;
  groupId?: string;
  groupName?: string;
};

export type Period = 'today' | 'week' | 'month' | 'year' | 'all';

export type MemberSpend = {
  id: string;
  name: string;
  amount: number;
  count: number;
};

export type GroupSpend = {
  id: string;
  name: string;
  amount: number;
  count: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  food: 'Food',
  groceries: 'Groceries',
  shopping: 'Shopping',
  transport: 'Transport',
  entertainment: 'Entertainment',
  bills: 'Bills',
  rent: 'Rent',
  taxes: 'Taxes',
  gifts: 'Gifts',
  donation: 'Donation',
  insurance: 'Insurance',
  personal_care: 'Personal Care',
  health: 'Health',
  other: 'Other',
};

export function formatINR(n: number): string {
  const rounded = Math.round(n);
  return `₹${rounded.toLocaleString('en-IN')}`;
}

export function categoryLabel(id: string): string {
  return CATEGORY_LABELS[id] || id;
}

function startOfPeriod(period: Period): Date | null {
  const now = new Date();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case 'today':
      return d;
    case 'week': {
      const day = d.getDay();
      const diff = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diff);
      return d;
    }
    case 'month':
      d.setDate(1);
      return d;
    case 'year':
      d.setMonth(0, 1);
      return d;
    default:
      return null;
  }
}

export function filterByPeriod(expenses: ExpenseInput[], period: Period): ExpenseInput[] {
  const start = startOfPeriod(period);
  if (!start) return expenses;
  const now = new Date();
  return expenses.filter(e => {
    const t = new Date(e.date).getTime();
    return !Number.isNaN(t) && t >= start.getTime() && t <= now.getTime();
  });
}

export function detectPeriod(text: string): Period {
  const t = text.toLowerCase();
  const order: Period[] = ['today', 'week', 'year', 'all', 'month'];
  for (const p of order) {
    if (textIncludesAny(t, PERIOD_SYNONYMS[p])) return p;
  }
  return 'month';
}

export function detectCategory(text: string): string | null {
  const t = text.toLowerCase();
  let best: { cat: string; len: number } | null = null;
  for (const [cat, keys] of Object.entries(CATEGORY_SYNONYMS)) {
    for (const k of keys) {
      if (k && t.includes(k.toLowerCase())) {
        if (!best || k.length > best.len) best = { cat, len: k.length };
      }
    }
  }
  return best?.cat ?? null;
}

function actorId(e: ExpenseInput): string {
  return (e.createdById || e.paidById || 'unknown').toString();
}

function actorName(e: ExpenseInput): string {
  return (e.createdByName || e.paidByName || 'Someone').trim() || 'Someone';
}

export function computeMemberBreakdown(
  expenses: ExpenseInput[],
  currentUserId?: string,
): {
  byMember: MemberSpend[];
  myTotal: number;
  myCount: number;
  partnerTotal: number;
  partnerCount: number;
  partnerName: string;
  memberSplitText: string;
} {
  const map = new Map<string, MemberSpend>();
  for (const e of expenses) {
    const id = actorId(e);
    const prev = map.get(id);
    if (prev) {
      prev.amount += e.amount;
      prev.count += 1;
      if (actorName(e) !== 'Someone') prev.name = actorName(e);
    } else {
      map.set(id, {
        id,
        name: currentUserId && id === currentUserId ? 'You' : actorName(e),
        amount: e.amount,
        count: 1,
      });
    }
  }

  const byMember = [...map.values()].sort((a, b) => b.amount - a.amount);
  if (currentUserId) {
    const me = byMember.find(m => m.id === currentUserId);
    if (me) me.name = 'You';
  }

  const my = currentUserId ? byMember.find(m => m.id === currentUserId) : undefined;
  const others = currentUserId
    ? byMember.filter(m => m.id !== currentUserId)
    : byMember;

  const partner =
    others.length === 1
      ? others[0]
      : others.length > 1
        ? {
            id: 'partners',
            name: 'Partners',
            amount: others.reduce((s, o) => s + o.amount, 0),
            count: others.reduce((s, o) => s + o.count, 0),
          }
        : { id: '', name: 'Partner', amount: 0, count: 0 };

  const memberSplitText = byMember.length
    ? byMember
        .map(m => `${m.name}: ${formatINR(m.amount)} (${m.count})`)
        .join(' · ')
    : 'No member data yet';

  return {
    byMember,
    myTotal: my?.amount ?? 0,
    myCount: my?.count ?? 0,
    partnerTotal: partner.amount,
    partnerCount: partner.count,
    partnerName: partner.name || 'Partner',
    memberSplitText,
  };
}

export function computeGroupBreakdown(expenses: ExpenseInput[]): {
  byGroup: GroupSpend[];
  groupSplitText: string;
} {
  const map = new Map<string, GroupSpend>();
  for (const e of expenses) {
    const id = e.groupId || 'joint';
    const name = e.groupName || 'Joint';
    const prev = map.get(id);
    if (prev) {
      prev.amount += e.amount;
      prev.count += 1;
    } else {
      map.set(id, { id, name, amount: e.amount, count: 1 });
    }
  }
  const byGroup = [...map.values()].sort((a, b) => b.amount - a.amount);
  const groupSplitText = byGroup.length
    ? byGroup.map(g => `${g.name}: ${formatINR(g.amount)} (${g.count})`).join(' · ')
    : '—';
  return { byGroup, groupSplitText };
}

export type Stats = {
  period: Period;
  periodLabel: string;
  count: number;
  total: number;
  todayTotal: number;
  monthTotal: number;
  monthSpent: number;
  topCategory: string | null;
  topCategoryAmount: number;
  secondTopCategory: string | null;
  secondTopCategoryAmount: number;
  topMerchant: string | null;
  topMerchantAmount: number;
  biggest: ExpenseInput | null;
  categoryAmount: number | null;
  categoryId: string | null;
  merchantQuery: string | null;
  merchantAmount: number;
  merchantCount: number;
  dateLabel: string | null;
  dateTotal: number;
  dateCount: number;
  budget: number;
  budgetMonth: string;
  remaining: number | null;
  overspend: number;
  isOverBudget: boolean;
  budgetUsedPct: number | null;
  isJoint: boolean;
  myTotal: number;
  myCount: number;
  partnerTotal: number;
  partnerCount: number;
  partnerName: string;
  memberSplitText: string;
  groupSplitText: string;
  groupCount: number;
  dayOfMonth: number;
  daysInMonth: number;
  daysLeft: number;
  avgPerDay: number;
  avgTxn: number;
  dailyBudget: number;
  idealSpendSoFar: number;
  projectedMonth: number;
  topCut10: number;
  topCut20: number;
  safeDaily: number;
  paceStatus: 'no_budget' | 'on_track' | 'fast' | 'slow' | 'over_budget';
  healthVerdict: string;
};

const PERIOD_LABEL_EN: Record<Period, string> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  year: 'this year',
  all: 'overall',
};

const PERIOD_LABEL_HI: Record<Period, string> = {
  today: 'aaj',
  week: 'is week',
  month: 'is month',
  year: 'is saal',
  all: 'ab tak',
};

export function computeStats(
  expenses: ExpenseInput[],
  opts: {
    period: Period;
    categoryId?: string | null;
    merchantQuery?: string | null;
    calendarDay?: CalendarDay | null;
    dateRange?: AssistantDateRange | null;
    timezoneOffsetMinutes?: number;
    monthlyBudget?: number;
    monthlyBudgets?: MonthlyBudgetEntry[];
    repeatMonthlyBudget?: boolean;
    clientToday?: string;
    isJoint?: boolean;
    currentUserId?: string;
    /** Reply language for period labels + health verdict */
    lang?: 'en' | 'hi';
  },
): Stats {
  const lang = opts.lang === 'hi' ? 'hi' : 'en';
  const PERIOD_LABEL = lang === 'hi' ? PERIOD_LABEL_HI : PERIOD_LABEL_EN;
  // Specific calendar day overrides relative period for the main list
  let periodList = opts.calendarDay
    ? expenses.filter(e => expenseOnDay(e, opts.calendarDay!))
    : opts.dateRange
      ? expenses.filter(e =>
          expenseInAssistantRange(e.date, opts.dateRange!, opts.timezoneOffsetMinutes),
        )
      : filterByPeriod(expenses, opts.period);

  if (opts.merchantQuery) {
    periodList = periodList.filter(e => expenseMatchesMerchant(e, opts.merchantQuery!));
  }

  const todayList = filterByPeriod(expenses, 'today');
  const total = periodList.reduce((s, e) => s + (e.amount || 0), 0);
  const todayTotal = todayList.reduce((s, e) => s + (e.amount || 0), 0);

  const catMap = new Map<string, number>();
  const merchMap = new Map<string, number>();
  periodList.forEach(e => {
    catMap.set(e.category, (catMap.get(e.category) || 0) + e.amount);
    const m = (e.merchantLabel || 'Unknown').trim();
    merchMap.set(m, (merchMap.get(m) || 0) + e.amount);
  });

  const catsRanked = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
  const topCat = catsRanked[0];
  const secondCat = catsRanked[1];
  const topMerch = [...merchMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const biggest = [...periodList].sort((a, b) => b.amount - a.amount)[0] || null;

  let categoryAmount: number | null = null;
  if (opts.categoryId) {
    // Category amount within the already-filtered period/day/merchant list
    categoryAmount = catMap.get(opts.categoryId) || 0;
  }

  const merchantQuery = opts.merchantQuery?.trim() || null;
  const merchantAmount = merchantQuery ? total : 0;
  const merchantCount = merchantQuery ? periodList.length : 0;
  const dateLabel = opts.calendarDay?.label || null;
  const dateTotal = opts.calendarDay ? total : 0;
  const dateCount = opts.calendarDay ? periodList.length : 0;

  const clientToday =
    opts.clientToday && /^\d{4}-\d{2}-\d{2}$/.test(opts.clientToday)
      ? opts.clientToday
      : new Date().toISOString().slice(0, 10);
  const currentMonth = clientToday.slice(0, 7);
  const budgetMonth = opts.calendarDay
    ? `${opts.calendarDay.y}-${String(opts.calendarDay.m + 1).padStart(2, '0')}`
    : opts.dateRange?.start.slice(0, 7) || currentMonth;
  const budgetEntries = normalizeMonthlyBudgets(opts.monthlyBudgets);
  const exactBudget = budgetEntries.find(entry => entry.month === budgetMonth);
  const repeatedBudget = opts.repeatMonthlyBudget
    ? [...budgetEntries].reverse().find(entry => entry.month < budgetMonth)
    : undefined;
  const legacyBudget =
    budgetMonth === currentMonth && Number.isFinite(opts.monthlyBudget)
      ? Math.max(0, opts.monthlyBudget || 0)
      : 0;
  const budget = exactBudget?.amount ?? repeatedBudget?.amount ?? legacyBudget;
  const monthTotal = expenses
    .filter(e => {
      const timestamp = new Date(e.date).getTime();
      if (Number.isNaN(timestamp)) return false;
      const localTimestamp = timestamp - (opts.timezoneOffsetMinutes || 0) * 60_000;
      return new Date(localTimestamp).toISOString().slice(0, 7) === budgetMonth;
    })
    .reduce((s, e) => s + e.amount, 0);
  const remaining = budget > 0 ? Math.max(0, budget - monthTotal) : null;
  const overspend = budget > 0 ? Math.max(0, monthTotal - budget) : 0;
  const isOverBudget = overspend > 0;
  const budgetUsedPct = budget > 0 ? Math.round((monthTotal / budget) * 100) : null;

  const members = computeMemberBreakdown(periodList, opts.currentUserId);
  const groups = computeGroupBreakdown(periodList);

  const isCurrentBudgetMonth = budgetMonth === currentMonth;
  const [budgetYear, budgetMonthNumber] = budgetMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(budgetYear, budgetMonthNumber, 0)).getUTCDate();
  const dayOfMonth = isCurrentBudgetMonth ? Number(clientToday.slice(8, 10)) : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - dayOfMonth);
  let avgPerDay = dayOfMonth > 0 ? monthTotal / dayOfMonth : 0;
  if (opts.dateRange) {
    const effectiveEnd = opts.dateRange.end < clientToday
      ? opts.dateRange.end
      : clientToday;
    const startMs = new Date(`${opts.dateRange.start}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${effectiveEnd}T00:00:00.000Z`).getTime();
    const rangeDays = Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1);
    avgPerDay = total / rangeDays;
  }
  const avgTxn = periodList.length > 0 ? total / periodList.length : 0;
  const dailyBudget = budget > 0 ? budget / daysInMonth : 0;
  const idealSpendSoFar = dailyBudget * dayOfMonth;
  const projectedMonth = isCurrentBudgetMonth ? avgPerDay * daysInMonth : monthTotal;
  const topCut10 = (topCat ? topCat[1] : 0) * 0.1;
  const topCut20 = (topCat ? topCat[1] : 0) * 0.2;
  const safeDaily = isCurrentBudgetMonth
    ? remaining != null && daysLeft > 0
      ? remaining / daysLeft
      : isOverBudget
        ? 0
        : dailyBudget
    : 0;

  let paceStatus: Stats['paceStatus'] = 'no_budget';
  let healthVerdict =
    lang === 'en'
      ? 'Set a monthly budget first — then I can tell you if spending looks healthy.'
      : 'Pehle monthly budget set karo — phir main bataunga spending theek hai ya nahi.';
  if (budget > 0) {
    const usedIdealPct = idealSpendSoFar > 0 ? monthTotal / idealSpendSoFar : 1;
    if (monthTotal > budget) {
      paceStatus = 'over_budget';
      healthVerdict =
        lang === 'en'
          ? `${budgetMonth} is over budget by ${formatINR(overspend)} — ${budgetUsedPct}% used.`
          : `${budgetMonth} ka budget ${formatINR(overspend)} se cross hua — ${budgetUsedPct}% use hua.`;
    } else if (!isCurrentBudgetMonth) {
      paceStatus = 'on_track';
      healthVerdict =
        lang === 'en'
          ? `${budgetMonth} closed with ${formatINR(monthTotal)} spent and ${formatINR(remaining ?? 0)} remaining.`
          : `${budgetMonth} me ${formatINR(monthTotal)} kharch hua aur ${formatINR(remaining ?? 0)} bacha.`;
    } else if (usedIdealPct > 1.15) {
      paceStatus = 'fast';
      healthVerdict =
        lang === 'en'
          ? `You're spending faster than ideal — expected ~${formatINR(idealSpendSoFar)} by today, actual ${formatINR(monthTotal)}.`
          : `Pace tez hai — aaj tak ideal ~${formatINR(idealSpendSoFar)}, tumhara ${formatINR(monthTotal)}.`;
    } else if (usedIdealPct < 0.85) {
      paceStatus = 'slow';
      healthVerdict =
        lang === 'en'
          ? `Nice pace — you're under the ideal so far (~${formatINR(idealSpendSoFar)}).`
          : `Achha pace — budget ke hisaab se abhi comfortable ho (ideal ~${formatINR(idealSpendSoFar)}).`;
    } else {
      paceStatus = 'on_track';
      healthVerdict =
        lang === 'en'
          ? `Spending looks on track — budget ${formatINR(budget)}, used ${budgetUsedPct}%, left ${formatINR(remaining ?? 0)}.`
          : `Spending track pe hai — budget ${formatINR(budget)}, used ${budgetUsedPct}%, bacha ${formatINR(remaining ?? 0)}.`;
    }
  }

  const periodLabel = opts.calendarDay
    ? opts.calendarDay.label
    : opts.dateRange
      ? lang === 'hi'
        ? opts.dateRange.labelHi
        : opts.dateRange.labelEn
    : PERIOD_LABEL[opts.period];

  return {
    period: opts.period,
    periodLabel,
    count: periodList.length,
    total,
    todayTotal,
    monthTotal,
    monthSpent: monthTotal,
    topCategory: topCat ? categoryLabel(topCat[0]) : null,
    topCategoryAmount: topCat ? topCat[1] : 0,
    secondTopCategory: secondCat ? categoryLabel(secondCat[0]) : null,
    secondTopCategoryAmount: secondCat ? secondCat[1] : 0,
    topMerchant: topMerch ? topMerch[0] : null,
    topMerchantAmount: topMerch ? topMerch[1] : 0,
    biggest,
    categoryAmount,
    categoryId: opts.categoryId || null,
    merchantQuery,
    merchantAmount,
    merchantCount,
    dateLabel,
    dateTotal,
    dateCount,
    budget,
    budgetMonth,
    remaining,
    overspend,
    isOverBudget,
    budgetUsedPct,
    isJoint: !!opts.isJoint,
    myTotal: members.myTotal,
    myCount: members.myCount,
    partnerTotal: members.partnerTotal,
    partnerCount: members.partnerCount,
    partnerName: members.partnerName,
    memberSplitText: members.memberSplitText,
    groupSplitText: groups.groupSplitText,
    groupCount: groups.byGroup.length,
    dayOfMonth,
    daysInMonth,
    daysLeft,
    avgPerDay,
    avgTxn,
    dailyBudget,
    idealSpendSoFar,
    projectedMonth,
    topCut10,
    topCut20,
    safeDaily,
    paceStatus,
    healthVerdict,
  };
}

export function fillTemplate(template: string, stats: Stats): string {
  const biggestStr = stats.biggest
    ? `${stats.biggest.merchantLabel} (${formatINR(stats.biggest.amount)})`
    : '—';

  const map: Record<string, string> = {
    '{period}': stats.periodLabel,
    '{total}': formatINR(stats.total),
    '{todayTotal}': formatINR(stats.todayTotal),
    '{monthTotal}': formatINR(stats.monthTotal),
    '{monthSpent}': formatINR(stats.monthSpent),
    '{count}': String(stats.count),
    '{topCategory}': stats.topCategory || 'Other',
    '{topCategoryAmount}': formatINR(stats.topCategoryAmount),
    '{secondTopCategory}': stats.secondTopCategory || '—',
    '{secondTopCategoryAmount}': formatINR(stats.secondTopCategoryAmount),
    '{topMerchant}': stats.topMerchant || '—',
    '{topMerchantAmount}': formatINR(stats.topMerchantAmount),
    '{biggest}': biggestStr,
    '{category}': stats.categoryId ? categoryLabel(stats.categoryId) : 'this category',
    '{categoryAmount}': formatINR(stats.categoryAmount ?? 0),
    '{merchantQuery}': stats.merchantQuery || 'them',
    '{merchantAmount}': formatINR(stats.merchantAmount),
    '{merchantCount}': String(stats.merchantCount),
    '{dateLabel}': stats.dateLabel || stats.periodLabel,
    '{dateTotal}': formatINR(stats.dateTotal || stats.total),
    '{dateCount}': String(stats.dateCount || stats.count),
    '{budget}': formatINR(stats.budget),
    '{budgetMonth}': stats.budgetMonth,
    '{remaining}': stats.remaining != null ? formatINR(stats.remaining) : '—',
    '{overspend}': formatINR(stats.overspend),
    '{isOverBudget}': stats.isOverBudget ? 'yes' : 'no',
    '{budgetUsedPct}': stats.budgetUsedPct != null ? `${stats.budgetUsedPct}%` : '—',
    '{scope}': stats.isJoint ? 'joint account' : 'personal',
    '{myTotal}': formatINR(stats.myTotal),
    '{myCount}': String(stats.myCount),
    '{partnerTotal}': formatINR(stats.partnerTotal),
    '{partnerCount}': String(stats.partnerCount),
    '{partnerName}': stats.partnerName,
    '{memberSplit}': stats.memberSplitText,
    '{groupSplit}': stats.groupSplitText,
    '{avgPerDay}': formatINR(stats.avgPerDay),
    '{avgTxn}': formatINR(stats.avgTxn),
    '{dailyBudget}': formatINR(stats.dailyBudget),
    '{idealSpendSoFar}': formatINR(stats.idealSpendSoFar),
    '{projectedMonth}': formatINR(stats.projectedMonth),
    '{topCut10}': formatINR(stats.topCut10),
    '{topCut20}': formatINR(stats.topCut20),
    '{safeDaily}': formatINR(stats.safeDaily),
    '{daysLeft}': String(stats.daysLeft),
    '{dayOfMonth}': String(stats.dayOfMonth),
    '{daysInMonth}': String(stats.daysInMonth),
    '{healthVerdict}': stats.healthVerdict,
  };

  let out = template;
  for (const [k, v] of Object.entries(map)) {
    out = out.split(k).join(v);
  }
  return out;
}
