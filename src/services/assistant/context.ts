import { detectPeriod, Period } from './stats';
import { PERIOD_SYNONYMS, textIncludesAny } from './lexicon';
import { isSalaryBudgetQuestion } from './salaryBudget';

export type HistoryTurn = {
  role: 'user' | 'assistant';
  text: string;
  intent?: string;
};

export type FollowUpResolution = {
  /** Text used for intent scoring (may include prior user question) */
  scoringMessage: string;
  forcedIntent?: string;
  forcedPeriod?: Period;
  usedContext: boolean;
  reason?: string;
  /**
   * User said previous answer was wrong / “nahi…” —
   * engine should prefer LLM (or a different intent), not repeat the same rules reply.
   */
  preferLlm?: boolean;
  /** Do not reuse this intent from the previous turn */
  avoidIntent?: string;
};

function normalize(msg: string): string {
  return msg
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function soften(s: string): string {
  return s
    .replace(/kharcha|kharche|kharchu/g, 'kharch')
    .replace(/\bkitne\b/g, 'kitna')
    .replace(/\bkitni\b/g, 'kitna')
    .replace(/\bbache\b/g, 'bacha')
    .replace(/\bjyada\b/g, 'zyada');
}

function hasAny(msg: string, words: string[]): boolean {
  return words.some(w => msg.includes(w));
}

function hasExplicitPeriod(text: string): boolean {
  const t = soften(normalize(text));
  for (const key of Object.keys(PERIOD_SYNONYMS) as Period[]) {
    if (textIncludesAny(t, PERIOD_SYNONYMS[key])) return true;
  }
  return false;
}

function tokenCount(msg: string): number {
  return msg.split(' ').filter(Boolean).length;
}

/** User pointing out wrong answer / rejecting previous reply (HI + EN). */
export function isCorrectionSignal(raw: string): boolean {
  const msg = soften(normalize(raw));
  if (!msg) return false;

  if (
    /^(nahi|nahin|nahe|naah|nope|wrong|incorrect|galat)\b/.test(msg) ||
    msg === 'no' ||
    msg.startsWith('no ') ||
    msg.startsWith('nahi ') ||
    msg.startsWith('nahin ')
  ) {
    return true;
  }

  const phrases = [
    'galat jawab',
    'galat ans',
    'galat hai',
    'ye galat',
    'yeh galat',
    'wrong answer',
    'incorrect answer',
    'not what i asked',
    'not what i meant',
    'thats not',
    "that's not",
    'that is not',
    'i didnt ask',
    "i didn't ask",
    'maine ye nahi',
    'maine yeh nahi',
    'ye nahi pucha',
    'yeh nahi pucha',
    'matlab nahi',
    'samajh nahi',
    'you misunderstood',
    'misunderstood',
    'try again',
    'dobara socho',
    'different answer',
    'alag jawab',
    'sahi se jawab',
    'i meant',
    'not joint',
    'joint nahi',
  ];
  return phrases.some(p => msg.includes(p));
}

/** True follow-up markers — NOT mera/meri (those appear in full new questions). */
const FOLLOW_MARKERS = [
  'aur', 'phir', 'fir', 'uska', 'uski', 'usne', 'unka', 'unki', 'unhone',
  'same', 'wahi', 'wohi', 'what about', 'and ', 'toh ', ' ab', 'ab ',
  'fir se', 'usi', 'dono me se', 'only me', 'only mera', 'sirf mera', 'sirf uska',
];

const SPEND_INTENTS = new Set([
  'total_spent',
  'today_spent',
  'my_spend',
  'partner_spend',
  'member_split',
  'by_category',
  'top_category',
  'top_merchant',
  'joint_summary',
  'biggest_expense',
]);

const JOINT_DEAD_END = new Set([
  'my_spend',
  'partner_spend',
  'member_split',
  'group_split',
  'joint_summary',
]);

/**
 * Resolve short / pronoun follow-ups using recent chat (local rules, no LLM).
 */
export function resolveFollowUp(
  rawMessage: string,
  history: HistoryTurn[],
  lastIntentHint?: string,
): FollowUpResolution {
  const msg = soften(normalize(rawMessage));
  if (!msg) {
    return { scoringMessage: rawMessage, usedContext: false };
  }

  if (isSalaryBudgetQuestion(msg) || isSalaryBudgetQuestion(rawMessage)) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: 'salary_budget',
      usedContext: true,
      reason: 'salary→ideal_budget',
    };
  }

  const recent = history.slice(-8);
  const prevIntent =
    lastIntentHint ||
    [...recent].reverse().find(h => h.role === 'assistant' && h.intent && h.intent !== 'empty')
      ?.intent;
  const prevUser = [...recent].reverse().find(h => h.role === 'user')?.text || '';
  const prevUserN = soften(normalize(prevUser));

  if (!prevIntent && !prevUserN) {
    return { scoringMessage: rawMessage, usedContext: false };
  }

  // User says we were wrong / “nahi…” → don't repeat same rules intent; prefer AI
  if (isCorrectionSignal(rawMessage) || isCorrectionSignal(msg)) {
    if (isSalaryBudgetQuestion(prevUserN) || isSalaryBudgetQuestion(prevUser)) {
      return {
        scoringMessage: prevUser,
        forcedIntent: 'salary_budget',
        usedContext: true,
        reason: 'correction→salary_budget',
        avoidIntent: prevIntent,
      };
    }

    const stripped = rawMessage
      .replace(/^\s*(nahi|nahin|nahe|nope|no)[,!.\s:-]*/i, '')
      .trim();
    const scoring =
      stripped.length >= 8
        ? stripped
        : prevUser
          ? `${prevUser}\n(User correction: ${rawMessage})`
          : rawMessage;

    return {
      scoringMessage: scoring,
      usedContext: true,
      preferLlm: true,
      avoidIntent: prevIntent,
      reason: 'correction→prefer_llm',
    };
  }

  const short = tokenCount(msg) <= 6;
  const marker = FOLLOW_MARKERS.some(m => msg.includes(m.trim()));
  const bareKitna = /^(kitna|kharch|total|same|wahi|wohi)( hai)?$/.test(msg);
  const looksFollowUp = short || marker || bareKitna;

  if (!looksFollowUp) {
    return { scoringMessage: rawMessage, usedContext: false };
  }

  const periodFromPrev = hasExplicitPeriod(prevUserN) ? detectPeriod(prevUserN) : undefined;
  const periodFromCur = hasExplicitPeriod(msg) ? detectPeriod(msg) : undefined;
  const forcedPeriod = periodFromCur || periodFromPrev;

  if (
    hasAny(msg, [
      'maine', 'mera', 'mere', 'meri', 'main ne', 'sirf mera', 'only me', 'my spend', 'i spent', 'my share',
    ])
  ) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: 'my_spend',
      forcedPeriod: forcedPeriod || 'month',
      usedContext: true,
      reason: 'followup→my_spend',
    };
  }

  if (
    hasAny(msg, [
      'partner', 'usne', 'uska', 'uski', 'unka', 'unki', 'unhone', 'dusre', 'wife', 'husband',
      'sirf uska', 'other person',
    ])
  ) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: 'partner_spend',
      forcedPeriod: forcedPeriod || 'month',
      usedContext: true,
      reason: 'followup→partner_spend',
    };
  }

  if (hasAny(msg, ['kisne', 'kaun', 'dono', 'split', 'member', 'contribution', 'har ek'])) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: 'member_split',
      forcedPeriod: forcedPeriod || 'month',
      usedContext: true,
      reason: 'followup→member_split',
    };
  }

  if (hasAny(msg, ['budget', 'bacha', 'remaining', 'left'])) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: 'budget_left',
      forcedPeriod: 'month',
      usedContext: true,
      reason: 'followup→budget_left',
    };
  }

  if (hasAny(msg, ['save', 'bachaye', 'tip', 'kaato', 'cut'])) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: 'saving_tips',
      forcedPeriod: 'month',
      usedContext: true,
      reason: 'followup→saving_tips',
    };
  }

  if (hasAny(msg, ['theek', 'sahi', 'pace', 'overspend', 'on track', 'healthy'])) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: 'budget_health',
      forcedPeriod: 'month',
      usedContext: true,
      reason: 'followup→budget_health',
    };
  }

  if (
    periodFromCur &&
    prevIntent &&
    SPEND_INTENTS.has(prevIntent) &&
    !hasAny(msg, ['maine', 'partner', 'uska', 'budget', 'save'])
  ) {
    return {
      scoringMessage: rawMessage,
      forcedIntent: prevIntent === 'today_spent' && periodFromCur !== 'today' ? 'total_spent' : prevIntent,
      forcedPeriod: periodFromCur,
      usedContext: true,
      reason: `followup→same intent ${prevIntent} @ ${periodFromCur}`,
    };
  }

  if ((bareKitna || hasAny(msg, ['same', 'wahi', 'wohi', 'usi tarah'])) && prevIntent) {
    if (JOINT_DEAD_END.has(prevIntent) && (isSalaryBudgetQuestion(prevUserN) || isSalaryBudgetQuestion(prevUser))) {
      return {
        scoringMessage: prevUser,
        forcedIntent: 'salary_budget',
        usedContext: true,
        reason: 'same→salary_budget',
      };
    }
    return {
      scoringMessage: prevUser ? `${prevUser} ${rawMessage}` : rawMessage,
      forcedIntent: prevIntent,
      forcedPeriod: forcedPeriod || (SPEND_INTENTS.has(prevIntent) ? 'month' : undefined),
      usedContext: true,
      reason: `followup→repeat ${prevIntent}`,
    };
  }

  if (short && prevUserN) {
    if (isSalaryBudgetQuestion(prevUserN) || isSalaryBudgetQuestion(prevUser)) {
      return {
        scoringMessage: `${prevUser} ${rawMessage}`,
        forcedIntent: 'salary_budget',
        usedContext: true,
        reason: 'short followup→salary_budget',
      };
    }
    return {
      scoringMessage: `${prevUser} ${rawMessage}`,
      forcedIntent: prevIntent && tokenCount(msg) <= 3 ? prevIntent : undefined,
      forcedPeriod: forcedPeriod,
      usedContext: true,
      reason: 'followup→merged prior question',
    };
  }

  return { scoringMessage: rawMessage, usedContext: false };
}

/** Compact history string for LLM fallback */
export function historyBrief(history: HistoryTurn[], limit = 4): string {
  const slice = history.filter(h => h.text?.trim()).slice(-limit);
  if (!slice.length) return '';
  return slice
    .map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text.slice(0, 160)}`)
    .join('\n');
}
