export type ExpenseInput = {
  amount: number;
  merchantLabel: string;
  category: string;
  note?: string;
  date: string;
};

export type Period = 'today' | 'week' | 'month' | 'year' | 'all';

const CATEGORY_LABELS: Record<string, string> = {
  food: 'Food',
  groceries: 'Groceries',
  shopping: 'Shopping',
  transport: 'Transport',
  entertainment: 'Entertainment',
  bills: 'Bills',
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
  return expenses.filter(e => {
    const t = new Date(e.date).getTime();
    return !Number.isNaN(t) && t >= start.getTime();
  });
}

export function detectPeriod(text: string): Period {
  const t = text.toLowerCase();
  if (/(aaj|today|aj)/.test(t)) return 'today';
  if (/(is hafte|this week|hafte|week)/.test(t)) return 'week';
  if (/(is saal|this year|saal|year)/.test(t)) return 'year';
  if (/(sab|all time|overall|pura|total history)/.test(t)) return 'all';
  return 'month';
}

export function detectCategory(text: string): string | null {
  const t = text.toLowerCase();
  const map: Record<string, string[]> = {
    food: ['food', 'khana', 'खाना', 'swiggy', 'zomato', 'lunch', 'dinner', 'breakfast', 'cafe'],
    groceries: ['grocer', 'kirana', 'किराना', 'blinkit', 'zepto', 'bigbasket', 'sabzi'],
    shopping: ['shop', 'shopping', 'myntra', 'amazon', 'flipkart', 'kapde', 'clothes'],
    transport: ['transport', 'uber', 'ola', 'petrol', 'fuel', 'auto', 'cab', 'travel', 'metro'],
    entertainment: ['movie', 'netflix', 'spotify', 'entertainment', 'game', 'fun'],
    bills: ['bill', 'recharge', 'electricity', 'wifi', 'rent', 'emi'],
    health: ['health', 'medicine', 'hospital', 'doctor', 'pharmacy', 'medical'],
  };
  for (const [cat, keys] of Object.entries(map)) {
    if (keys.some(k => t.includes(k))) return cat;
  }
  return null;
}

export type Stats = {
  period: Period;
  periodLabel: string;
  count: number;
  total: number;
  todayTotal: number;
  topCategory: string | null;
  topCategoryAmount: number;
  topMerchant: string | null;
  topMerchantAmount: number;
  biggest: ExpenseInput | null;
  categoryAmount: number | null;
  categoryId: string | null;
  budget: number;
  remaining: number | null;
  budgetUsedPct: number | null;
  isJoint: boolean;
};

const PERIOD_LABEL: Record<Period, string> = {
  today: 'aaj',
  week: 'is hafte',
  month: 'is month',
  year: 'is saal',
  all: 'ab tak',
};

export function computeStats(
  expenses: ExpenseInput[],
  opts: {
    period: Period;
    categoryId?: string | null;
    monthlyBudget?: number;
    isJoint?: boolean;
  },
): Stats {
  const periodList = filterByPeriod(expenses, opts.period);
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

  const topCat = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const topMerch = [...merchMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const biggest = [...periodList].sort((a, b) => b.amount - a.amount)[0] || null;

  let categoryAmount: number | null = null;
  if (opts.categoryId) {
    categoryAmount = catMap.get(opts.categoryId) || 0;
  }

  const budget = opts.monthlyBudget || 0;
  const monthTotal = filterByPeriod(expenses, 'month').reduce((s, e) => s + e.amount, 0);
  const remaining = budget > 0 ? Math.max(0, budget - monthTotal) : null;
  const budgetUsedPct = budget > 0 ? Math.round((monthTotal / budget) * 100) : null;

  return {
    period: opts.period,
    periodLabel: PERIOD_LABEL[opts.period],
    count: periodList.length,
    total,
    todayTotal,
    topCategory: topCat ? categoryLabel(topCat[0]) : null,
    topCategoryAmount: topCat ? topCat[1] : 0,
    topMerchant: topMerch ? topMerch[0] : null,
    topMerchantAmount: topMerch ? topMerch[1] : 0,
    biggest,
    categoryAmount,
    categoryId: opts.categoryId || null,
    budget,
    remaining,
    budgetUsedPct,
    isJoint: !!opts.isJoint,
  };
}

export function fillTemplate(template: string, stats: Stats): string {
  const biggestStr = stats.biggest
    ? `${stats.biggest.merchantLabel} (${formatINR(stats.biggest.amount)})`
    : 'kuch khaas nahi';

  return template
    .replaceAll('{period}', stats.periodLabel)
    .replaceAll('{total}', formatINR(stats.total))
    .replaceAll('{todayTotal}', formatINR(stats.todayTotal))
    .replaceAll('{count}', String(stats.count))
    .replaceAll('{topCategory}', stats.topCategory || 'Other')
    .replaceAll('{topCategoryAmount}', formatINR(stats.topCategoryAmount))
    .replaceAll('{topMerchant}', stats.topMerchant || '—')
    .replaceAll('{topMerchantAmount}', formatINR(stats.topMerchantAmount))
    .replaceAll('{biggest}', biggestStr)
    .replaceAll(
      '{category}',
      stats.categoryId ? categoryLabel(stats.categoryId) : 'is category',
    )
    .replaceAll(
      '{categoryAmount}',
      formatINR(stats.categoryAmount ?? 0),
    )
    .replaceAll('{budget}', formatINR(stats.budget))
    .replaceAll(
      '{remaining}',
      stats.remaining != null ? formatINR(stats.remaining) : '—',
    )
    .replaceAll(
      '{budgetUsedPct}',
      stats.budgetUsedPct != null ? `${stats.budgetUsedPct}%` : '—',
    )
    .replaceAll('{scope}', stats.isJoint ? 'joint account' : 'personal');
}
