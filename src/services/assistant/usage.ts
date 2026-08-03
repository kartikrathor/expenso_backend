import { AssistantUsage } from '../../models/AssistantUsage';
import { effectiveDailyTokens } from '../proEntitlements';

export type TokenKind = 'rules' | 'ai' | 'chip';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** @deprecated Prefer effectiveDailyTokens(userId) — free users get 0 */
export function dailyTokenLimit(): number {
  const n = Number(process.env.ASSISTANT_DAILY_TOKENS || 500);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

/**
 * Costs (defaults):
 * - AI (LLM) = 25 → ~20 AI messages / day from 500
 * - Rules (keyboard, non-AI) = 1 → slow burn, hundreds of msgs
 * - Chip tap = 0 → free suggested questions
 */
export function tokenCost(kind: TokenKind): number {
  if (kind === 'ai') {
    const n = Number(process.env.ASSISTANT_TOKEN_AI || 25);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
  }
  if (kind === 'chip') {
    const n = Number(process.env.ASSISTANT_TOKEN_CHIP || 0);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  const n = Number(process.env.ASSISTANT_TOKEN_RULES || 1);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

export function aiEnabled(): boolean {
  const v = (process.env.ASSISTANT_AI_ENABLED || 'true').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

export type TokenSpendResult = {
  ok: boolean;
  used: number;
  remaining: number;
  limit: number;
  cost: number;
};

async function getOrCreate(userId: string, day: string) {
  return AssistantUsage.findOneAndUpdate(
    { userId, day },
    { $setOnInsert: { tokensUsed: 0, aiCalls: 0 } },
    { upsert: true, new: true },
  );
}

export async function getTokenUsage(userId: string): Promise<{
  used: number;
  remaining: number;
  limit: number;
  aiCalls: number;
  costs: { rules: number; ai: number; chip: number };
}> {
  const limit = await effectiveDailyTokens(userId);
  const day = todayKey();
  const doc = await AssistantUsage.findOne({ userId, day }).lean();
  const used = doc?.tokensUsed ?? 0;
  return {
    used,
    remaining: Math.max(0, limit - used),
    limit,
    aiCalls: doc?.aiCalls ?? 0,
    costs: {
      rules: tokenCost('rules'),
      ai: tokenCost('ai'),
      chip: tokenCost('chip'),
    },
  };
}

/** @deprecated use getTokenUsage — kept for old /usage clients */
export async function getAiUsage(userId: string): Promise<{ used: number; limit: number }> {
  const u = await getTokenUsage(userId);
  return { used: u.used, limit: u.limit };
}

/**
 * Reserve `cost` tokens. Rolls back if over daily limit.
 * For AI calls, also increments aiCalls when ok.
 */
export async function consumeTokens(
  userId: string,
  cost: number,
  opts?: { countAi?: boolean },
): Promise<TokenSpendResult> {
  const limit = await effectiveDailyTokens(userId);
  const day = todayKey();
  const amount = Math.max(0, Math.floor(cost));

  if (limit <= 0) {
    return { ok: false, used: 0, remaining: 0, limit: 0, cost: amount };
  }

  if (amount === 0) {
    const doc = await getOrCreate(userId, day);
    const used = doc?.tokensUsed ?? 0;
    return { ok: true, used, remaining: Math.max(0, limit - used), limit, cost: 0 };
  }

  const doc = await AssistantUsage.findOneAndUpdate(
    { userId, day },
    {
      $inc: {
        tokensUsed: amount,
        ...(opts?.countAi ? { aiCalls: 1 } : {}),
      },
      $setOnInsert: {},
    },
    { upsert: true, new: true },
  );

  const used = doc?.tokensUsed ?? amount;
  if (used > limit) {
    await AssistantUsage.updateOne(
      { userId, day },
      {
        $inc: {
          tokensUsed: -amount,
          ...(opts?.countAi ? { aiCalls: -1 } : {}),
        },
      },
    );
    return {
      ok: false,
      used: Math.min(used - amount, limit),
      remaining: Math.max(0, limit - Math.min(used - amount, limit)),
      limit,
      cost: amount,
    };
  }

  return {
    ok: true,
    used,
    remaining: Math.max(0, limit - used),
    limit,
    cost: amount,
  };
}

/** Refund tokens after a failed LLM call */
export async function refundTokens(userId: string, cost: number, opts?: { countAi?: boolean }) {
  const amount = Math.max(0, Math.floor(cost));
  if (amount === 0) return;
  const day = todayKey();
  await AssistantUsage.updateOne(
    { userId, day },
    {
      $inc: {
        tokensUsed: -amount,
        ...(opts?.countAi ? { aiCalls: -1 } : {}),
      },
    },
  );
}

/** Resolve cost for this user message before we know AI vs rules */
export function costForInput(inputMode: 'keyboard' | 'chip', kind: 'rules' | 'ai'): number {
  if (inputMode === 'chip' && kind === 'rules') return tokenCost('chip');
  return tokenCost(kind);
}
