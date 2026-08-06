export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MonthlyBudgetEntry {
  month: string;
  amount: number;
}

export type MonthlyBudgetsInput =
  | MonthlyBudgetEntry[]
  | Record<string, number>
  | null
  | undefined;

export function currentUtcMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function isValidMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY_PATTERN.test(value);
}

export function isValidBudgetAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function normalizeMonthlyBudgets(input: unknown): MonthlyBudgetEntry[] {
  const values: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? Object.entries(input).map(([month, amount]) => ({ month, amount }))
      : [];
  const byMonth = new Map<string, number>();

  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const { month, amount } = value as { month?: unknown; amount?: unknown };
    if (isValidMonthKey(month) && isValidBudgetAmount(amount)) {
      byMonth.set(month, amount);
    }
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));
}

export function monthlyBudgetsMap(input: unknown): Record<string, number> {
  return Object.fromEntries(
    normalizeMonthlyBudgets(input).map(({ month, amount }) => [month, amount]),
  );
}

export function resolveMonthlyBudget(options: {
  month: string;
  monthlyBudgets: unknown;
  repeatMonthlyBudget?: boolean;
  legacyMonthlyBudget?: number;
  currentMonth?: string;
}): number {
  const entries = normalizeMonthlyBudgets(options.monthlyBudgets);
  const exact = entries.find(entry => entry.month === options.month);
  if (exact) return exact.amount;

  if (options.repeatMonthlyBudget) {
    const latest = [...entries].reverse().find(entry => entry.month <= options.month);
    if (latest) return latest.amount;
  }

  const currentMonth = options.currentMonth || currentUtcMonth();
  if (
    options.month === currentMonth &&
    isValidBudgetAmount(options.legacyMonthlyBudget)
  ) {
    return options.legacyMonthlyBudget;
  }
  return 0;
}

export function upsertMonthlyBudget(
  input: unknown,
  month: string,
  amount: number,
): MonthlyBudgetEntry[] {
  return normalizeMonthlyBudgets([
    ...normalizeMonthlyBudgets(input).filter(entry => entry.month !== month),
    { month, amount },
  ]);
}

export function budgetPayload(
  source: {
    monthlyBudget?: number;
    monthlyBudgets?: unknown;
    repeatMonthlyBudget?: boolean;
  },
  month: string,
) {
  const monthlyBudgets = normalizeMonthlyBudgets(source.monthlyBudgets);
  return {
    monthlyBudget: resolveMonthlyBudget({
      month,
      monthlyBudgets,
      repeatMonthlyBudget: source.repeatMonthlyBudget,
      legacyMonthlyBudget: source.monthlyBudget,
    }),
    month,
    monthlyBudgets,
    repeatMonthlyBudget: source.repeatMonthlyBudget ?? false,
  };
}
