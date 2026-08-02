import { AssistantIntent, AssistantMiss } from '../../models/AssistantIntent';
import {
  computeStats,
  detectCategory,
  detectPeriod,
  ExpenseInput,
  fillTemplate,
  formatINR,
  Stats,
} from './stats';
import { completeChat, hasAnyLlmKey } from './llm';
import {
  detectChatLang,
  FALLBACK_CHIPS_BY_LANG,
  pickLocalizedChips,
  ChatLang,
} from './locale';
import { historyBrief, HistoryTurn, resolveFollowUp } from './context';
import {
  aiEnabled,
  consumeTokens,
  costForInput,
  dailyTokenLimit,
  refundTokens,
  tokenCost,
} from './usage';

export type ChatResult = {
  reply: string;
  intent: string;
  chips: string[];
  matched: boolean;
  source: 'rules' | 'llm' | 'fallback';
  /** @deprecated prefer tokensRemaining */
  aiRemaining?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
  tokenCost?: number;
};

function normalize(msg: string): string {
  return msg
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Soften common Hinglish spelling so “kharcha/kharchu” still hit “kharch”. */
function soften(s: string): string {
  return s
    .replace(/kharcha|kharche|kharchu|kharcha/g, 'kharch')
    .replace(/\bkitne\b/g, 'kitna')
    .replace(/\bkitni\b/g, 'kitna')
    .replace(/\bbache\b/g, 'bacha')
    .replace(/\bbachi\b/g, 'bacha')
    .replace(/\bzyadaa\b/g, 'zyada')
    .replace(/\bjyada\b/g, 'zyada');
}

function scoreIntent(messageRaw: string, patterns: string[]): number {
  const message = soften(normalize(messageRaw));
  const msgTokens = message.split(' ').filter(Boolean);
  const msgSet = new Set(msgTokens);
  let best = 0;

  for (const p of patterns) {
    const pat = soften(normalize(p));
    if (!pat) continue;

    if (message === pat) {
      best = Math.max(best, 100);
      continue;
    }
    // Either side can contain the other (short msgs vs long patterns)
    if (message.includes(pat)) {
      best = Math.max(best, 70 + Math.min(pat.length, 25));
      continue;
    }
    // Only if user typed a reasonably specific phrase (avoid “kitna” matching everything)
    if (message.length >= 10 && pat.includes(message)) {
      best = Math.max(best, 68 + Math.min(message.length, 20));
      continue;
    }

    const patTokens = pat.split(' ').filter(Boolean);
    if (patTokens.length === 0) continue;

    const hit = patTokens.filter(t => msgSet.has(t)).length;
    const ratioPat = hit / patTokens.length;
    const ratioMsg = msgTokens.length ? hit / msgTokens.length : 0;

    // Pattern mostly covered by the message
    if (ratioPat >= 0.6 && hit >= 2) {
      best = Math.max(best, Math.round(45 + ratioPat * 40));
    } else if (ratioPat >= 0.75 && hit >= 1) {
      best = Math.max(best, Math.round(42 + ratioPat * 35));
    }
    // Short message where most words hit a longer pattern
    if (msgTokens.length <= 5 && ratioMsg >= 0.6 && hit >= 2) {
      best = Math.max(best, Math.round(48 + ratioMsg * 30));
    }
  }
  return best;
}

function pickTemplate(templates: string[]): string {
  if (!templates.length) return 'Hmm, data ke hisaab se abhi clear jawab nahi de paya.';
  return templates[Math.floor(Math.random() * templates.length)];
}

const FALLBACK_CHIPS = FALLBACK_CHIPS_BY_LANG.en;

const EMPTY_REPLIES = [
  'Abhi is period me koi expense nahi mila. Pehle kuch add karo, phir poochho!',
  'Data empty hai — ek-do expenses add karke dobara try karo.',
];

function withTokens(
  result: Omit<ChatResult, 'tokensRemaining' | 'tokensLimit' | 'tokenCost' | 'aiRemaining'>,
  spend: { remaining: number; limit: number; cost: number },
  lang: ChatLang = 'en',
): ChatResult {
  return {
    ...result,
    chips: pickLocalizedChips(result.chips, lang),
    tokensRemaining: spend.remaining,
    tokensLimit: spend.limit,
    tokenCost: spend.cost,
    aiRemaining: spend.remaining,
  };
}

function statsBrief(stats: Stats): string {
  return [
    `period=${stats.periodLabel}`,
    `total=${formatINR(stats.total)}`,
    `today=${formatINR(stats.todayTotal)}`,
    `count=${stats.count}`,
    `topCategory=${stats.topCategory || 'n/a'} (${formatINR(stats.topCategoryAmount)})`,
    `topMerchant=${stats.topMerchant || 'n/a'} (${formatINR(stats.topMerchantAmount)})`,
    `budget=${formatINR(stats.budget)}`,
    `remaining=${stats.remaining != null ? formatINR(stats.remaining) : 'n/a'}`,
    `budgetUsedPct=${stats.budgetUsedPct ?? 'n/a'}`,
    `scope=${stats.isJoint ? 'joint' : 'personal'}`,
    `myTotal=${formatINR(stats.myTotal)} (${stats.myCount})`,
    `partner=${stats.partnerName} ${formatINR(stats.partnerTotal)} (${stats.partnerCount})`,
    `memberSplit=${stats.memberSplitText}`,
    `groupSplit=${stats.groupSplitText}`,
    `avgPerDay=${formatINR(stats.avgPerDay)}`,
    `projectedMonth=${formatINR(stats.projectedMonth)}`,
    `safeDaily=${formatINR(stats.safeDaily)}`,
    `idealSoFar=${formatINR(stats.idealSpendSoFar)}`,
    `pace=${stats.paceStatus}`,
    `health=${stats.healthVerdict}`,
    `daysLeft=${stats.daysLeft}`,
  ].join('\n');
}

async function llmFallbackReply(input: {
  userMessage: string;
  userId?: string;
  stats: Stats;
  inputMode: 'keyboard' | 'chip';
  history?: HistoryTurn[];
  lang: ChatLang;
}): Promise<ChatResult | null> {
  if (!aiEnabled() || !hasAnyLlmKey() || !input.userId) return null;

  const cost = costForInput(input.inputMode, 'ai');
  const credit = await consumeTokens(input.userId, cost, { countAi: true });
  if (!credit.ok) {
    return withTokens(
      {
        reply:
          input.lang === 'en'
            ? `Today's AI tokens are used up (AI ~${tokenCost('ai')}/msg, daily ${dailyTokenLimit()}). Try clear chip questions for now — resets tomorrow.`
            : `Aaj ke AI tokens kam pad gaye (AI ~${tokenCost('ai')} tokens/msg, daily ${dailyTokenLimit()}). Chips / clear questions abhi bhi chalenge. Kal reset.`,
        intent: 'ai_limit',
        chips: FALLBACK_CHIPS_BY_LANG[input.lang],
        matched: false,
        source: 'fallback',
      },
      { remaining: credit.remaining, limit: credit.limit, cost: 0 },
      input.lang,
    );
  }

  try {
    const prior = historyBrief(input.history || [], 4);
    const { text } = await completeChat([
      {
        role: 'system',
        content:
          'You are Expenso, a friendly expense coach for India. ' +
          `Answer in ${input.lang === 'en' ? 'English' : 'Hindi/Hinglish'} unless the user mixes languages. ` +
          'ONLY use the provided numbers — never invent amounts. ' +
          'Use recent chat if the user asks a follow-up (e.g. maine/partner/aur aaj). ' +
          'You can give short save tips, budget pace judgment, and simple calcs from the stats. ' +
          'For joint accounts use myTotal / partner / memberSplit / groupSplit when relevant. ' +
          'Keep reply under 70 words. If data is missing, say so. No markdown.',
      },
      {
        role: 'user',
        content:
          (prior ? `Recent chat:\n${prior}\n\n` : '') +
          `Current question: ${input.userMessage}\n\nVerified expense stats:\n${statsBrief(input.stats)}`,
      },
    ]);

    return withTokens(
      {
        reply: text.slice(0, 800),
        intent: 'llm_assist',
        chips: FALLBACK_CHIPS_BY_LANG[input.lang],
        matched: true,
        source: 'llm',
      },
      { remaining: credit.remaining, limit: credit.limit, cost: credit.cost },
      input.lang,
    );
  } catch (err) {
    console.error('LLM fallback failed:', err);
    await refundTokens(input.userId, cost, { countAi: true });
    return null;
  }
}

async function spendRules(
  userId: string | undefined,
  inputMode: 'keyboard' | 'chip',
): Promise<{ ok: boolean; remaining: number; limit: number; cost: number }> {
  const limit = dailyTokenLimit();
  if (!userId) {
    return { ok: true, remaining: limit, limit, cost: 0 };
  }
  const cost = costForInput(inputMode, 'rules');
  const res = await consumeTokens(userId, cost);
  return {
    ok: res.ok,
    remaining: res.remaining,
    limit: res.limit,
    cost: res.ok ? res.cost : 0,
  };
}

export async function runAssistantChat(input: {
  message: string;
  userId?: string;
  expenses: ExpenseInput[];
  monthlyBudget?: number;
  isJoint?: boolean;
  /** keyboard = typed; chip = suggestion tap (cheaper / free) */
  inputMode?: 'keyboard' | 'chip';
  history?: HistoryTurn[];
  lastIntent?: string;
  lang?: ChatLang;
}): Promise<ChatResult> {
  const inputMode = input.inputMode === 'chip' ? 'chip' : 'keyboard';
  const lang: ChatLang =
    input.lang === 'hi' || input.lang === 'en' ? input.lang : detectChatLang(input.message || '');
  const history = (input.history || [])
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .map(h => ({
      role: h.role,
      text: String(h.text).slice(0, 400),
      intent: h.intent,
    }))
    .slice(-8);

  const wt = (
    result: Omit<ChatResult, 'tokensRemaining' | 'tokensLimit' | 'tokenCost' | 'aiRemaining'>,
    spend: { remaining: number; limit: number; cost: number },
  ) => withTokens(result, spend, lang);

  const message = normalize(input.message || '');
  if (!message) {
    return {
      reply:
        lang === 'en'
          ? 'Ask something — like “how much this month” or “budget left?”'
          : 'Kuch poochho — jaise “is month kitna kharch” ya “budget bacha?”',
      intent: 'empty',
      chips: FALLBACK_CHIPS_BY_LANG[lang],
      matched: false,
      source: 'fallback',
      tokensLimit: dailyTokenLimit(),
      tokensRemaining: dailyTokenLimit(),
      tokenCost: 0,
    };
  }

  const follow = resolveFollowUp(input.message, history, input.lastIntent);
  const scoreText = follow.scoringMessage || input.message;

  const intents = await AssistantIntent.find({ active: true }).lean();
  let bestKey = 'unknown';
  let bestScore = 0;
  let bestDoc: (typeof intents)[0] | null = null;

  for (const intent of intents) {
    const scoreMerged = scoreIntent(scoreText, intent.patterns || []);
    const scoreRaw = scoreIntent(input.message, intent.patterns || []);
    const score = Math.max(scoreMerged, scoreRaw);
    if (score > bestScore) {
      bestScore = score;
      bestKey = intent.key;
      bestDoc = intent;
    }
  }

  // Local follow-up wins over weak lexical match
  if (follow.forcedIntent) {
    const forced = intents.find(i => i.key === follow.forcedIntent);
    if (forced) {
      bestKey = forced.key;
      bestDoc = forced;
      bestScore = Math.max(bestScore, 95);
    }
  }

  // Rules first; AI only when score is weak
  const threshold = bestKey === 'greeting' || bestKey === 'help' ? 32 : 40;
  console.log(
    `Ask match: "${input.message.slice(0, 60)}" → ${bestKey} score=${bestScore} ` +
      `(need ${threshold}${follow.usedContext ? `, ctx=${follow.reason}` : ''}) → ` +
      `${bestDoc && bestScore >= threshold ? 'RULES' : 'AI/fallback'}`,
  );

  const periodHint = follow.forcedPeriod || detectPeriod(scoreText);
  const baseStats = computeStats(input.expenses || [], {
    period: periodHint,
    monthlyBudget: input.monthlyBudget || 0,
    isJoint: input.isJoint,
    currentUserId: input.userId,
  });

  if (!bestDoc || bestScore < threshold) {
    await AssistantMiss.create({
      userId: input.userId,
      message: input.message.slice(0, 500),
    }).catch(() => {});

    const llm = await llmFallbackReply({
      userMessage: input.message,
      userId: input.userId,
      stats: baseStats,
      inputMode,
      history,
      lang,
    });
    if (llm) return llm;

    // Unknown without AI — still a rules-ish soft reply; charge slow keyboard cost
    const soft = await spendRules(input.userId, inputMode);
    if (!soft.ok) {
      return wt(
        {
          reply:
            lang === 'en'
              ? `Today's ${soft.limit} tokens are used up. Resets tomorrow.`
              : `Aaj ke ${soft.limit} tokens khatam. Kal reset — chips try karo ya kal wapas aao.`,
          intent: 'token_limit',
          chips: FALLBACK_CHIPS_BY_LANG[lang],
          matched: false,
          source: 'fallback',
        },
        soft,
      );
    }
    return wt(
      {
        reply:
          lang === 'en'
            ? "I didn't catch that exactly — try spend / budget / category below 👇"
            : 'Ye exact samajh nahi aaya, lekin main kharch / budget / category bata sakta hoon. Niche se try karo 👇',
        intent: 'unknown',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: false,
        source: 'fallback',
      },
      soft,
    );
  }

  // Matched rules path — spend cheap tokens
  const spend = await spendRules(input.userId, inputMode);
  if (!spend.ok) {
    return wt(
      {
        reply:
          lang === 'en'
            ? `Today's ${spend.limit} tokens are used up. Resets tomorrow.`
            : `Aaj ke ${spend.limit} tokens khatam ho gaye. Kal reset hoga — thoda break lo ☕`,
        intent: 'token_limit',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: false,
        source: 'fallback',
      },
      spend,
    );
  }

  let period = follow.forcedPeriod || detectPeriod(scoreText);
  if (bestKey === 'today_spent') period = 'today';
  const monthIntents = [
    'budget_left',
    'budget_health',
    'daily_avg',
    'projected_month',
    'safe_daily',
    'saving_tips',
    'where_high',
    'cut_estimate',
    'general_tips',
    'compare_hint',
  ];
  if (monthIntents.includes(bestKey) && !follow.forcedPeriod) period = 'month';

  const categoryId = detectCategory(scoreText) || detectCategory(input.message);

  let intentKey = bestKey;
  let doc = bestDoc;
  if (bestKey === 'by_category' && !categoryId) {
    const top = intents.find(i => i.key === 'top_category');
    if (top) {
      intentKey = 'top_category';
      doc = top;
    }
  }

  const jointOnly = ['my_spend', 'partner_spend', 'member_split', 'group_split', 'joint_summary'];
  if (jointOnly.includes(intentKey) && !input.isJoint) {
    return wt(
      {
        reply:
          'Ye sawaal joint account ke liye hai. Pehle Profile se joint banao / join karo, phir “maine kitna” ya “partner ne kitna” poochho.',
        intent: intentKey,
        chips: ['Is month kitna kharch?', 'Budget bacha?', 'Top category'],
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  const stats = computeStats(input.expenses || [], {
    period,
    categoryId: intentKey === 'by_category' ? categoryId : null,
    monthlyBudget: input.monthlyBudget || 0,
    isJoint: input.isJoint,
    currentUserId: input.userId,
  });

  const allowEmpty = [
    'greeting',
    'help',
    'budget_left',
    'general_tips',
    'budget_health',
  ];
  if (stats.count === 0 && !allowEmpty.includes(intentKey)) {
    return wt(
      {
        reply: pickTemplate(EMPTY_REPLIES),
        intent: intentKey,
        chips: doc.chips?.length ? doc.chips : FALLBACK_CHIPS,
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  if (
    (intentKey === 'budget_left' || intentKey === 'budget_health' || intentKey === 'safe_daily') &&
    stats.budget <= 0
  ) {
    return wt(
      {
        reply:
          'Abhi monthly budget set nahi hai. Home pe Budget save karo — phir main pace, safe/day aur “kya spending theek” bataunga.',
        intent: intentKey,
        chips: ['Is month kitna kharch?', 'Save kaise?', 'Top category'],
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  if (intentKey === 'general_tips' && stats.count === 0) {
    return wt(
      {
        reply:
          'Tip: pehle 7 din expenses add karo, monthly budget set karo, phir weekly 10-min review. Food delivery + impulse UPI pe soft limit rakho.',
        intent: intentKey,
        chips: doc.chips?.length ? doc.chips : FALLBACK_CHIPS,
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  if (
    (intentKey === 'my_spend' || intentKey === 'partner_spend' || intentKey === 'member_split') &&
    !input.expenses.some(e => e.createdById || e.paidById)
  ) {
    return wt(
      {
        reply:
          'Joint expenses me abhi member info incomplete hai. Naye expenses add karo — phir maine / partner / kisne kitna clear dikhega.',
        intent: intentKey,
        chips: doc.chips?.length ? doc.chips : FALLBACK_CHIPS,
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  const reply = fillTemplate(pickTemplate(doc.templates || []), stats);

  return wt(
    {
      reply,
      intent: intentKey,
      chips: doc.chips?.length ? doc.chips : FALLBACK_CHIPS,
      matched: true,
      source: 'rules',
    },
    spend,
  );
}
