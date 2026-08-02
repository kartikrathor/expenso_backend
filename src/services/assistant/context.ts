import { detectPeriod, Period } from './stats';
import { PERIOD_SYNONYMS, textIncludesAny } from './lexicon';

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

const FOLLOW_MARKERS = [
  'aur', 'phir', 'fir', 'uska', 'uski', 'usne', 'unka', 'unki', 'unhone',
  'mera', 'meri', 'maine', 'mere', 'main ne', 'same', 'wahi', 'wohi',
  'what about', 'and ', 'toh ', ' ab', 'ab ', 'fir se', 'usi', 'dono me se',
  'only me', 'only mera', 'sirf mera', 'sirf uska',
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

/**
 * Resolve short / pronoun follow-ups using recent chat (local rules, no LLM).
 * Example: "partner ne kitna?" → then "maine kitna?" / "aur aaj?" / "uska?"
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

  // --- Subject switches (common after joint / spend questions) ---
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

  // Period-only follow-up: "aur aaj?", "this week?", keep prior spend intent
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

  // Bare "kitna?" / "same" → repeat previous intent
  if ((bareKitna || hasAny(msg, ['same', 'wahi', 'wohi', 'usi tarah'])) && prevIntent) {
    return {
      scoringMessage: prevUser ? `${prevUser} ${rawMessage}` : rawMessage,
      forcedIntent: prevIntent,
      forcedPeriod: forcedPeriod || (SPEND_INTENTS.has(prevIntent) ? 'month' : undefined),
      usedContext: true,
      reason: `followup→repeat ${prevIntent}`,
    };
  }

  // Short vague follow-up: boost scoring with previous user question
  if (short && prevUserN) {
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
