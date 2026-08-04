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
  applyLangNotice,
  FALLBACK_CHIPS_BY_LANG,
  llmReplyInstruction,
  pickLocalizedChips,
  pickTemplateForLang,
  resolveLangPolicy,
  ChatLang,
  LangPolicy,
} from './locale';
import { historyBrief, HistoryTurn, resolveFollowUp } from './context';
import {
  buildSalaryBudgetAdvice,
  extractMoneyAmount,
  isSalaryBudgetQuestion,
} from './salaryBudget';
import {
  detectCalendarDate,
  detectMerchantFromExpenses,
  isOnDateQuestion,
  isTransferQuestion,
} from './transferDate';
import {
  aiEnabled,
  consumeTokens,
  costForInput,
  dailyTokenLimit,
  refundTokens,
  tokenCost,
} from './usage';
import { buildQaLearningPrompt, learnFromLlmExchange, pickLearnedRulesReply, ADVISOR_VOICE } from './qaLearning';
import {
  APP_GUIDE_INTENT_KEYS,
  appGuideLlmBlock,
  isAppGuideQuestion,
} from './appGuide';

export type ChatResult = {
  reply: string;
  intent: string;
  chips: string[];
  matched: boolean;
  source: 'rules' | 'llm' | 'fallback' | 'precise';
  /** @deprecated prefer tokensRemaining */
  aiRemaining?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
  tokenCost?: number;
  /** Detected user language + whether we fell back to English */
  lang?: {
    detected: string;
    replyLang: ChatLang;
    unsupported: boolean;
    label: string;
  };
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

function pickTemplate(templates: string[] | undefined, lang: ChatLang): string {
  return pickTemplateForLang(templates, lang);
}

const FALLBACK_CHIPS = FALLBACK_CHIPS_BY_LANG.en;

const EMPTY_REPLIES: Record<ChatLang, string[]> = {
  en: [
    'No expenses found for this period. Add a few first, then ask again.',
    'Nothing logged here yet — add one or two expenses and try again.',
  ],
  hi: [
    'Abhi is period me koi expense nahi mila. Pehle kuch add karo, phir poochho!',
    'Data empty hai — ek-do expenses add karke dobara try karo.',
  ],
};

function withTokens(
  result: Omit<ChatResult, 'tokensRemaining' | 'tokensLimit' | 'tokenCost' | 'aiRemaining' | 'lang'>,
  spend: { remaining: number; limit: number; cost: number },
  policy: LangPolicy,
): ChatResult {
  const replyLang = policy.replyLang;
  return {
    ...result,
    reply: applyLangNotice(result.reply, policy),
    chips: pickLocalizedChips(result.chips, replyLang),
    tokensRemaining: spend.remaining,
    tokensLimit: spend.limit,
    tokenCost: spend.cost,
    aiRemaining: spend.remaining,
    lang: {
      detected: policy.detected,
      replyLang: policy.replyLang,
      unsupported: policy.unsupported,
      label: policy.label,
    },
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
    stats.merchantQuery
      ? `merchantMatch=${stats.merchantQuery} amount=${formatINR(stats.merchantAmount)} count=${stats.merchantCount}`
      : null,
    stats.dateLabel
      ? `date=${stats.dateLabel} total=${formatINR(stats.dateTotal)} count=${stats.dateCount}`
      : null,
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
  ]
    .filter(Boolean)
    .join('\n');
}

/** Compact recent ledger for precise AI — never shown to the user in the UI. */
function expensesBrief(expenses: ExpenseInput[], limit = 50): string {
  if (!expenses.length) return '(no expenses logged)';
  const sorted = [...expenses]
    .filter(e => e && e.amount > 0)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
  return sorted
    .map(e => {
      const day = (e.date || '').slice(0, 10) || '?';
      const who = e.createdByName || e.paidByName || '';
      const note = e.note ? ` note=${e.note.slice(0, 40)}` : '';
      const group = e.groupName ? ` group=${e.groupName}` : '';
      return `${day} | ${formatINR(e.amount)} | ${e.merchantLabel || 'Unknown'} | ${e.category || 'other'}${who ? ` | by=${who}` : ''}${group}${note}`;
    })
    .join('\n');
}

/**
 * User tapped “more accurate answer” — force LLM with stats + recent expense rows.
 * Response text only; do not expose that raw data was sent.
 */
export async function runPreciseAnswer(input: {
  message: string;
  previousReply?: string;
  userId?: string;
  expenses: ExpenseInput[];
  monthlyBudget?: number;
  isJoint?: boolean;
  history?: HistoryTurn[];
  lang?: ChatLang;
}): Promise<ChatResult> {
  const policy = resolveLangPolicy(input.message || '', input.lang);
  const lang = policy.replyLang;
  const emptySpend = {
    remaining: dailyTokenLimit(),
    limit: dailyTokenLimit(),
    cost: 0,
  };

  if (!input.message?.trim()) {
    return withTokens(
      {
        reply: lang === 'en' ? 'Ask a question first.' : 'Pehle sawaal likho.',
        intent: 'empty',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: false,
        source: 'fallback',
      },
      emptySpend,
      policy,
    );
  }

  if (!aiEnabled() || !hasAnyLlmKey() || !input.userId) {
    return withTokens(
      {
        reply:
          lang === 'en'
            ? 'Precise AI is unavailable right now. Try again later or rephrase your question.'
            : 'Precise AI abhi available nahi. Thodi der baad try karo ya sawaal clear likho.',
        intent: 'ai_unavailable',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: false,
        source: 'fallback',
      },
      emptySpend,
      policy,
    );
  }

  const stats = computeStats(input.expenses || [], {
    period: 'month',
    monthlyBudget: input.monthlyBudget || 0,
    isJoint: input.isJoint,
    currentUserId: input.userId,
    lang,
  });
  const statsAll = computeStats(input.expenses || [], {
    period: 'all',
    monthlyBudget: input.monthlyBudget || 0,
    isJoint: input.isJoint,
    currentUserId: input.userId,
    lang,
  });

  const cost = costForInput('keyboard', 'ai');
  const credit = await consumeTokens(input.userId, cost, { countAi: true });
  if (!credit.ok) {
    return withTokens(
      {
        reply:
          lang === 'en'
            ? `Today's AI tokens are used up (daily ${dailyTokenLimit()}). Precise answers reset tomorrow.`
            : `Aaj ke AI tokens khatam (daily ${dailyTokenLimit()}). Precise answers kal reset.`,
        intent: 'ai_limit',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: false,
        source: 'fallback',
      },
      { remaining: credit.remaining, limit: credit.limit, cost: 0 },
      policy,
    );
  }

  try {
    const prior = historyBrief(input.history || [], 6);
    const ledger = expensesBrief(input.expenses || [], 50);
    const qaHint = await buildQaLearningPrompt(input.message.trim());
    const guideHint = isAppGuideQuestion(input.message) ? `\n\n${appGuideLlmBlock(lang)}` : '';
    const { text } = await completeChat([
      {
        role: 'system',
        content:
          ADVISOR_VOICE +
          llmReplyInstruction(policy) +
          ' The user tapped “Need a more accurate answer” — the previous quick reply was NOT good enough. ' +
          'Re-read their intent carefully. Use verified stats AND the recent expense ledger. Never invent amounts. ' +
          'If they asked how to use the app (joint, themes, budget setup, etc.), answer with clear UI steps — don’t invent spend data. ' +
          'Do NOT mention that you were given a data dump, ledger, JSON, or private payload — just answer naturally. ' +
          'If the previous reply was incomplete or wrong, correct it briefly then give the better advisor answer. ' +
          'Be specific with ₹ figures when the question is about spend. Keep under 110 words. No markdown.' +
          (qaHint ? `\n\n${qaHint}` : '') +
          guideHint,
      },
      {
        role: 'user',
        content:
          (prior ? `Recent chat:\n${prior}\n\n` : '') +
          `User question: ${input.message.trim()}\n` +
          (input.previousReply
            ? `Previous quick reply (user rejected this — learn from the mistake):\n${input.previousReply.slice(0, 500)}\n\n`
            : '') +
          `Verified stats (this month):\n${statsBrief(stats)}\n\n` +
          `Verified stats (all time):\n${statsBrief(statsAll)}\n\n` +
          `Recent expenses (newest first, hidden from user UI):\n${ledger}`,
      },
    ]);

    const reply = text.slice(0, 1200);
    // Precise = strong training signal: teach local rules Q→A + style for next time
    await learnFromLlmExchange({
      question: input.message.trim(),
      answer: reply,
      source: 'precise',
      userId: input.userId,
      stats,
    });

    return withTokens(
      {
        reply,
        intent: 'llm_precise',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: true,
        source: 'precise',
      },
      { remaining: credit.remaining, limit: credit.limit, cost: credit.cost },
      policy,
    );
  } catch (err) {
    console.error('Precise AI failed:', err);
    await refundTokens(input.userId, cost, { countAi: true });
    return withTokens(
      {
        reply:
          lang === 'en'
            ? 'Could not get a precise answer right now. Please try again in a moment.'
            : 'Precise answer abhi nahi mil paya. Thodi der baad try karo.',
        intent: 'ai_error',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: false,
        source: 'fallback',
      },
      emptySpend,
      policy,
    );
  }
}

async function llmFallbackReply(input: {
  userMessage: string;
  userId?: string;
  stats: Stats;
  inputMode: 'keyboard' | 'chip';
  history?: HistoryTurn[];
  policy: LangPolicy;
  intentKey?: string;
  /** User rejected previous rules answer — re-answer carefully */
  correction?: boolean;
  priorQuestion?: string;
}): Promise<ChatResult | null> {
  if (!aiEnabled() || !hasAnyLlmKey() || !input.userId) return null;

  const lang = input.policy.replyLang;
  const cost = costForInput(input.inputMode, 'ai');
  const credit = await consumeTokens(input.userId, cost, { countAi: true });
  if (!credit.ok) {
    return withTokens(
      {
        reply:
          lang === 'en'
            ? `Today's AI tokens are used up (AI ~${tokenCost('ai')}/msg, daily ${dailyTokenLimit()}). Try clear chip questions for now — resets tomorrow.`
            : `Aaj ke AI tokens kam pad gaye (AI ~${tokenCost('ai')} tokens/msg, daily ${dailyTokenLimit()}). Chips / clear questions abhi bhi chalenge. Kal reset.`,
        intent: 'ai_limit',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: false,
        source: 'fallback',
      },
      { remaining: credit.remaining, limit: credit.limit, cost: 0 },
      input.policy,
    );
  }

  try {
    const prior = historyBrief(input.history || [], 4);
    const correctionNote = input.correction
      ? ' The user says your previous reply was wrong or not what they asked. ' +
        'Do NOT repeat the same mistaken interpretation (e.g. do not push joint-account setup unless they clearly asked). ' +
        'Re-read their original question and answer that. Apologize briefly in one short clause, then give the correct answer. '
      : '';
    const learnQuestion = (input.priorQuestion || input.userMessage || '').trim();
    const questionBlock = input.priorQuestion
      ? `Original question: ${input.priorQuestion}\nUser follow-up/correction: ${input.userMessage}`
      : `Current question: ${input.userMessage}`;

    const qaHint = await buildQaLearningPrompt(learnQuestion);
    const guideHint = isAppGuideQuestion(learnQuestion)
      ? `\n\n${appGuideLlmBlock(lang)}`
      : '';
    const { text } = await completeChat([
      {
        role: 'system',
        content:
          ADVISOR_VOICE +
          llmReplyInstruction(input.policy) +
          correctionNote +
          ' ONLY use the provided numbers — never invent amounts. ' +
          'First understand intent (totals, budget left, category, merchant, tip, joint split, pace, OR app how-to). ' +
          'If they ask how to use Expenso (joint account, themes, add expense, Pro, settings), give short UI steps from the app guide — ignore spend stats. ' +
          'Use recent chat if the user asks a follow-up (e.g. maine/partner/aur aaj). ' +
          'You can give short save tips, budget pace judgment, salary→budget rules of thumb (50/30/20), and simple calcs from the stats. ' +
          'For joint accounts use myTotal / partner / memberSplit / groupSplit when relevant. ' +
          'Keep reply under 80 words. If data is missing, say so. No markdown.' +
          (qaHint ? `\n\n${qaHint}` : '') +
          guideHint,
      },
      {
        role: 'user',
        content:
          (prior ? `Recent chat:\n${prior}\n\n` : '') +
          `${questionBlock}\n\nVerified expense stats:\n${statsBrief(input.stats)}`,
      },
    ]);

    const reply = text.slice(0, 800);
    await learnFromLlmExchange({
      question: learnQuestion,
      answer: reply,
      source: 'llm',
      userId: input.userId,
      stats: input.stats,
      intentKey: input.intentKey,
    });

    return withTokens(
      {
        reply,
        intent: input.correction ? 'llm_correction' : 'llm_assist',
        chips: FALLBACK_CHIPS_BY_LANG[lang],
        matched: true,
        source: 'llm',
      },
      { remaining: credit.remaining, limit: credit.limit, cost: credit.cost },
      input.policy,
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
  if (!userId) {
    return { ok: false, remaining: 0, limit: 0, cost: 0 };
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

function tokenGateReply(lang: 'en' | 'hi', limit: number): { reply: string; intent: string } {
  if (limit <= 0) {
    return {
      reply:
        lang === 'en'
          ? 'Ask Expenso is a Pro feature. Upgrade to unlock AI chat, chips, and daily tokens.'
          : 'Ask Expenso Pro feature hai. Upgrade karke AI chat, chips aur daily tokens unlock karo.',
      intent: 'pro_required',
    };
  }
  return {
    reply:
      lang === 'en'
        ? `Today's ${limit} tokens are used up. Resets tomorrow.`
        : `Aaj ke ${limit} tokens khatam. Kal reset hoga.`,
    intent: 'token_limit',
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
  const policy = resolveLangPolicy(input.message || '', input.lang);
  const lang = policy.replyLang;
  const history = (input.history || [])
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .map(h => ({
      role: h.role,
      text: String(h.text).slice(0, 400),
      intent: h.intent,
    }))
    .slice(-8);

  const wt = (
    result: Omit<ChatResult, 'tokensRemaining' | 'tokensLimit' | 'tokenCost' | 'aiRemaining' | 'lang'>,
    spend: { remaining: number; limit: number; cost: number },
  ) => withTokens(result, spend, policy);

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
      lang: {
        detected: policy.detected,
        replyLang: policy.replyLang,
        unsupported: policy.unsupported,
        label: policy.label,
      },
    };
  }

  const follow = resolveFollowUp(input.message, history, input.lastIntent);
  const scoreText = follow.scoringMessage || input.message;
  const askingAppGuide = isAppGuideQuestion(input.message);

  const intents = await AssistantIntent.find({ active: true }).lean();
  let bestKey = 'unknown';
  let bestScore = 0;
  let bestDoc: (typeof intents)[0] | null = null;

  for (const intent of intents) {
    if (follow.avoidIntent && intent.key === follow.avoidIntent) continue;
    // Spend-summary intents shouldn't steal “joint account kya hai / themes kaise”
    if (
      askingAppGuide &&
      !intent.key.startsWith('app_') &&
      intent.key !== 'help' &&
      intent.key !== 'greeting' &&
      (intent.key === 'joint_summary' ||
        intent.key === 'budget_left' ||
        intent.key === 'saving_tips' ||
        intent.key === 'general_tips')
    ) {
      continue;
    }
    const scoreMerged = scoreIntent(scoreText, intent.patterns || []);
    const scoreRaw = scoreIntent(input.message, intent.patterns || []);
    let score = Math.max(scoreMerged, scoreRaw);
    // Prefer product how-tos when the user is clearly asking about the app
    if (askingAppGuide && intent.key.startsWith('app_')) {
      score += 18;
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = intent.key;
      bestDoc = intent;
    }
  }

  // Local follow-up wins over weak lexical match (unless correction said avoid that intent)
  if (follow.forcedIntent && follow.forcedIntent !== follow.avoidIntent) {
    const forced = intents.find(i => i.key === follow.forcedIntent);
    if (forced) {
      bestKey = forced.key;
      bestDoc = forced;
      bestScore = Math.max(bestScore, 95);
    }
  }

  // Rules first; AI when score weak OR user corrected previous wrong answer
  const isAppGuideIntent = bestKey.startsWith('app_');
  const threshold =
    bestKey === 'greeting' || bestKey === 'help' || isAppGuideIntent ? 32 : 40;
  const forceLlm =
    !!follow.preferLlm &&
    (!bestDoc || bestScore < threshold || bestKey === follow.avoidIntent);

  console.log(
    `Ask match: "${input.message.slice(0, 60)}" → ${bestKey} score=${bestScore} ` +
      `(need ${threshold}${follow.usedContext ? `, ctx=${follow.reason}` : ''}` +
      `${forceLlm ? ', correction→LLM' : ''}) → ` +
      `${!forceLlm && bestDoc && bestScore >= threshold ? 'RULES' : 'AI/fallback'}`,
  );

  const periodHint = follow.forcedPeriod || detectPeriod(scoreText);
  const baseStats = computeStats(input.expenses || [], {
    period: periodHint,
    monthlyBudget: input.monthlyBudget || 0,
    isJoint: input.isJoint,
    currentUserId: input.userId,
    lang,
  });

  const priorUserQ = [...history].reverse().find(h => h.role === 'user')?.text;

  if (forceLlm || !bestDoc || bestScore < threshold) {
    // Reuse only fillable templates with current stats. Context-dependent
    // follow-ups and corrections still go to the LLM to avoid a stale/wrong reply.
    if (!forceLlm && !follow.usedContext) {
      const learned = await pickLearnedRulesReply(input.message, bestKey, baseStats, lang);
      if (learned) {
        const spend = await spendRules(input.userId, inputMode);
        if (!spend.ok) {
          const gate = tokenGateReply(lang, spend.limit);
          return wt(
            {
              reply: gate.reply,
              intent: gate.intent,
              chips: FALLBACK_CHIPS_BY_LANG[lang],
              matched: false,
              source: 'fallback',
            },
            spend,
          );
        }
        return wt(
          {
            reply: learned,
            intent: bestDoc ? bestKey : 'learned_answer',
            chips: FALLBACK_CHIPS_BY_LANG[lang],
            matched: true,
            source: 'rules',
          },
          spend,
        );
      }
    }

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
      policy,
      correction: !!follow.preferLlm,
      priorQuestion: follow.preferLlm ? priorUserQ : undefined,
      intentKey: bestDoc && bestScore >= 25 ? bestKey : undefined,
    });
    if (llm) return llm;

    // Unknown without AI — still a rules-ish soft reply; charge slow keyboard cost
    const soft = await spendRules(input.userId, inputMode);
    if (!soft.ok) {
      const gate = tokenGateReply(lang, soft.limit);
      return wt(
        {
          reply: gate.reply,
          intent: gate.intent,
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
            ? "Sorry — I misunderstood earlier. Try rephrasing, or use spend / budget / category below 👇"
            : 'Sorry — pehle galat samajh gaya. Thoda clear likho, ya niche spend / budget / category try karo 👇',
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
    const gate = tokenGateReply(lang, spend.limit);
    return wt(
      {
        reply: gate.reply,
        intent: gate.intent,
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
  const merchantHit =
    detectMerchantFromExpenses(scoreText, input.expenses || []) ||
    detectMerchantFromExpenses(input.message, input.expenses || []);
  const calendarDay =
    detectCalendarDate(scoreText) || detectCalendarDate(input.message);

  let intentKey = bestKey;
  let doc = bestDoc;

  // App how-tos: answer from templates — no spend stats / joint gates / entity upgrades
  if (intentKey.startsWith('app_')) {
    const reply = pickTemplate(doc?.templates || [], lang);
    return wt(
      {
        reply,
        intent: intentKey,
        chips: doc?.chips?.length ? doc.chips : FALLBACK_CHIPS_BY_LANG[lang],
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  // Entity extractors can upgrade a weak/wrong match
  if (
    (isTransferQuestion(scoreText) || isTransferQuestion(input.message) || intentKey === 'by_merchant') &&
    merchantHit
  ) {
    const mDoc = intents.find(i => i.key === 'by_merchant');
    if (mDoc) {
      intentKey = 'by_merchant';
      doc = mDoc;
    }
  } else if (
    (isOnDateQuestion(scoreText) || isOnDateQuestion(input.message) || intentKey === 'on_date') &&
    calendarDay
  ) {
    const dDoc = intents.find(i => i.key === 'on_date');
    if (dDoc) {
      intentKey = 'on_date';
      doc = dDoc;
    }
  }

  if (bestKey === 'by_category' && !categoryId && intentKey === 'by_category') {
    const top = intents.find(i => i.key === 'top_category');
    if (top) {
      intentKey = 'top_category';
      doc = top;
    }
  }

  const jointOnly = ['my_spend', 'partner_spend', 'member_split', 'group_split', 'joint_summary'];

  // Salary → ideal budget must never fall into joint-only gate
  if (
    intentKey === 'salary_budget' ||
    follow.forcedIntent === 'salary_budget' ||
    isSalaryBudgetQuestion(input.message)
  ) {
    const salaryDoc = intents.find(i => i.key === 'salary_budget') || doc;
    const amount =
      extractMoneyAmount(input.message) ||
      extractMoneyAmount(scoreText) ||
      (history.length
        ? extractMoneyAmount([...history].reverse().find(h => h.role === 'user')?.text || '')
        : null);

    if (amount && amount >= 1000) {
      return wt(
        {
          reply: buildSalaryBudgetAdvice(amount, lang),
          intent: 'salary_budget',
          chips: salaryDoc?.chips?.length
            ? salaryDoc.chips
            : ['Budget bacha?', 'Save kaise?', 'Kya spending theek?'],
          matched: true,
          source: 'rules',
        },
        spend,
      );
    }

    return wt(
      {
        reply: pickTemplate(
          salaryDoc?.templates?.length
            ? salaryDoc.templates
            : [
                'Tell me your salary (e.g. “salary 50000”) and I’ll suggest an ideal monthly budget using 50/30/20.',
                'Salary amount batao (jaise “salary 50000”) — main 50/30/20 se ideal monthly budget suggest karunga.',
              ],
          lang,
        ),
        intent: 'salary_budget',
        chips: salaryDoc?.chips?.length
          ? salaryDoc.chips
          : ['Budget bacha?', 'Save kaise?', 'Kya spending theek?'],
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  // Transfer to person/merchant — need a name
  if (intentKey === 'by_merchant') {
    if (!merchantHit) {
      return wt(
        {
          reply:
            lang === 'en'
              ? 'Who did you send to? Try “how much did I send to Rahul” or “Rahul ko kitna bheja this month”.'
              : 'Kis naam pe? Jaise “maine Rahul ko kitne bheje” ya “Priya ko is month kitna send kiya”.',
          intent: 'by_merchant',
          chips: doc?.chips?.length ? doc.chips : ['Is month kitna?', 'Ab tak kitna?', 'Top merchant'],
          matched: true,
          source: 'rules',
        },
        spend,
      );
    }

    const stats = computeStats(input.expenses || [], {
      period: calendarDay ? 'all' : period,
      merchantQuery: merchantHit.query,
      calendarDay,
      monthlyBudget: input.monthlyBudget || 0,
      isJoint: input.isJoint,
      currentUserId: input.userId,
      lang,
    });

    return wt(
      {
        reply:
          (await pickLearnedRulesReply(input.message, 'by_merchant', stats, lang)) ||
          fillTemplate(
            pickTemplate(
              doc?.templates?.length
                ? doc.templates
                : [
                    'In {period}, transfers/payments to “{merchantQuery}” add up to {merchantAmount} across {merchantCount} entries. Biggest was {biggest}.',
                    '{period} me “{merchantQuery}” ko/pe total {merchantAmount} gaya ({merchantCount} entries). Sabse bada: {biggest}.',
                  ],
              lang,
            ),
            stats,
          ),
        intent: 'by_merchant',
        chips: doc?.chips?.length ? doc.chips : ['Is month kitna?', 'Ab tak kitna?', 'Top merchant'],
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  // Specific calendar day analysis
  if (intentKey === 'on_date') {
    if (!calendarDay) {
      return wt(
        {
          reply:
            lang === 'en'
              ? 'Which date? Try “3 August ko kitna”, “15/08 spending”, or “kal kitna hua”.'
              : 'Kaunsi date? Jaise “3 August ko kitna hua”, “15 tarikh ko kitna”, ya “kal kitna”.',
          intent: 'on_date',
          chips: doc?.chips?.length ? doc.chips : ['Aaj kitna?', 'Is month kitna?', 'Top category'],
          matched: true,
          source: 'rules',
        },
        spend,
      );
    }

    const stats = computeStats(input.expenses || [], {
      period: 'all',
      calendarDay,
      monthlyBudget: input.monthlyBudget || 0,
      isJoint: input.isJoint,
      currentUserId: input.userId,
      lang,
    });

    return wt(
      {
        reply:
          (await pickLearnedRulesReply(input.message, 'on_date', stats, lang)) ||
          fillTemplate(
            pickTemplate(
              doc?.templates?.length
                ? doc.templates
                : [
                    'On {dateLabel}, you spent {dateTotal} across {dateCount} transactions. The biggest was {biggest}.',
                    '{dateLabel} ko aapka kharch {dateTotal} tha ({dateCount} entries). Sabse bada: {biggest}.',
                  ],
              lang,
            ),
            stats,
          ),
        intent: 'on_date',
        chips: doc?.chips?.length ? doc.chips : ['Is month kitna?', 'Aaj kitna?', 'Top category'],
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  if (jointOnly.includes(intentKey) && !input.isJoint) {
    return wt(
      {
        reply:
          lang === 'en'
            ? 'This question is for a joint account. Create or join a joint from Profile, then ask “How much did I spend?” or “Partner spend?”.'
            : 'Ye sawaal joint account ke liye hai. Pehle Profile se joint banao / join karo, phir “maine kitna” ya “partner ne kitna” poochho.',
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
    lang,
  });

  const allowEmpty = [
    'greeting',
    'help',
    'budget_left',
    'general_tips',
    'budget_health',
    'salary_budget',
    ...APP_GUIDE_INTENT_KEYS,
  ];
  if (stats.count === 0 && !allowEmpty.includes(intentKey)) {
    return wt(
      {
        reply: pickTemplate(EMPTY_REPLIES[lang], lang),
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
          lang === 'en'
            ? 'No monthly budget is set yet. Save a budget on Home — then I can show pace, safe daily spend, and whether spending looks healthy.'
            : 'Abhi monthly budget set nahi hai. Home pe Budget save karo — phir main pace, safe/day aur “kya spending theek” bataunga.',
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
          lang === 'en'
            ? 'Tip: log expenses for a week, set a monthly budget, then do a 10-minute weekly review. Put soft limits on food delivery and impulse UPI spends.'
            : 'Tip: pehle 7 din expenses add karo, monthly budget set karo, phir weekly 10-min review. Food delivery + impulse UPI pe soft limit rakho.',
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
          lang === 'en'
            ? 'Member info on joint expenses is incomplete. Add a few new expenses — then I can show your share vs partner clearly.'
            : 'Joint expenses me abhi member info incomplete hai. Naye expenses add karo — phir maine / partner / kisne kitna clear dikhega.',
        intent: intentKey,
        chips: doc.chips?.length ? doc.chips : FALLBACK_CHIPS,
        matched: true,
        source: 'rules',
      },
      spend,
    );
  }

  // Prefer a reply shape learned from Gemini / “more accurate” when it fits this Q
  const learned = await pickLearnedRulesReply(input.message, intentKey, stats, lang);
  const reply =
    learned || fillTemplate(pickTemplate(doc.templates || [], lang), stats);

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
