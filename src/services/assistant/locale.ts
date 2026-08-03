/**
 * Ask Expenso language policy
 *
 * Supported reply templates / chips: English + Hindi/Hinglish only.
 * Other Indic scripts (Tamil, Telugu, …) are detected so we can:
 *  - still match intents (patterns may include native script / roman)
 *  - answer in English with a short notice until that locale is ready
 *  - ask the LLM to understand the user message but reply in English
 */

import { PERIOD_SYNONYMS, textIncludesAny } from './lexicon';

export type ChatLang = 'en' | 'hi';

/** Detected user language (script / strong signal). */
export type DetectedLang =
  | ChatLang
  | 'ta'
  | 'te'
  | 'kn'
  | 'ml'
  | 'bn'
  | 'gu'
  | 'pa'
  | 'or'
  | 'mr'
  | 'other';

export type LangPolicy = {
  detected: DetectedLang;
  /** Language used for templates / chips / LLM reply instruction */
  replyLang: ChatLang;
  /** True when we don't ship native replies for this language yet */
  unsupported: boolean;
  /** Human label for notices */
  label: string;
  /** One-line notice to prepend on rules replies (English) */
  notice: string | null;
};

const HI_ROMAN = [
  'kya', 'hai', 'kitna', 'kitne', 'kharch', 'bacha', 'bachaye', 'kaise', 'kahan',
  'zyada', 'jyada', 'maine', 'mera', 'mere', 'usne', 'uska', 'dono',
  'aaj', 'paisa', 'theek', 'sahi', 'madad', 'batao', 'thoda', 'kam',
];

const SCRIPT_RULES: { re: RegExp; lang: DetectedLang; label: string }[] = [
  { re: /[\u0900-\u097F]/, lang: 'hi', label: 'Hindi' },
  { re: /[\u0B80-\u0BFF]/, lang: 'ta', label: 'Tamil' },
  { re: /[\u0C00-\u0C7F]/, lang: 'te', label: 'Telugu' },
  { re: /[\u0C80-\u0CFF]/, lang: 'kn', label: 'Kannada' },
  { re: /[\u0D00-\u0D7F]/, lang: 'ml', label: 'Malayalam' },
  { re: /[\u0980-\u09FF]/, lang: 'bn', label: 'Bengali' },
  { re: /[\u0A80-\u0AFF]/, lang: 'gu', label: 'Gujarati' },
  { re: /[\u0A00-\u0A7F]/, lang: 'pa', label: 'Punjabi' },
  { re: /[\u0B00-\u0B7F]/, lang: 'or', label: 'Odia' },
];

const UNSUPPORTED_LABELS: Partial<Record<DetectedLang, string>> = {
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  or: 'Odia',
  mr: 'Marathi',
  other: 'this language',
};

/** Detect script / Hindi-roman; default English. */
export function detectDetectedLang(text: string): DetectedLang {
  const t = (text || '').trim();
  if (!t) return 'en';

  for (const rule of SCRIPT_RULES) {
    if (rule.re.test(t)) return rule.lang;
  }

  const lower = t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ');
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 'en';
  const hiHits = tokens.filter(w => HI_ROMAN.includes(w)).length;
  if (hiHits >= 2 || (hiHits >= 1 && tokens.length <= 4)) return 'hi';
  return 'en';
}

export function detectChatLang(text: string): ChatLang {
  const d = detectDetectedLang(text);
  return d === 'hi' ? 'hi' : 'en';
}

export function resolveLangPolicy(
  text: string,
  clientHint?: ChatLang | string,
): LangPolicy {
  const detected = detectDetectedLang(text);
  const supported = detected === 'en' || detected === 'hi';

  let replyLang: ChatLang = supported ? detected : 'en';
  if ((clientHint === 'hi' || clientHint === 'en') && supported) {
    replyLang = clientHint;
  }

  if (supported) {
    return {
      detected,
      replyLang,
      unsupported: false,
      label: detected === 'hi' ? 'Hindi' : 'English',
      notice: null,
    };
  }

  const label = UNSUPPORTED_LABELS[detected] || 'this language';
  return {
    detected,
    replyLang: 'en',
    unsupported: true,
    label,
    notice:
      `I can read ${label}, but full ${label} replies aren't ready yet — answering in English. ` +
      `You can also ask in English or Hindi.`,
  };
}

/** Prepend language notice once (rules / soft fallbacks). */
export function applyLangNotice(reply: string, policy: LangPolicy): string {
  if (!policy.unsupported || !policy.notice) return reply;
  const body = (reply || '').trim();
  if (!body) return policy.notice;
  if (body.includes("aren't ready yet")) return body;
  return `${policy.notice}\n\n${body}`;
}

export function llmReplyInstruction(policy: LangPolicy): string {
  if (policy.unsupported) {
    return (
      `The user wrote in ${policy.label}. Understand their question, but reply in clear English only ` +
      `(we do not ship native ${policy.label} templates yet). ` +
      `Start with one short line that ${policy.label} replies are coming soon, then give the expense answer. ` +
      `Use complete, grammatical sentences.`
    );
  }
  if (policy.replyLang === 'hi') {
    return (
      'Reply ONLY in natural Hinglish (Roman Hindi with common English words like budget, spend, save). ' +
      'Do NOT reply in pure English. Keep 1–3 short, clear sentences with correct grammar. ' +
      'Never invent broken phrases like "Budget already cross" — say "Budget cross ho chuka hai" instead.'
    );
  }
  return (
    'Reply ONLY in clear, grammatical English. Do NOT use Hinglish or Hindi words. ' +
    'Keep 1–3 short sentences. Lead with the key number when relevant.'
  );
}

/** Heuristic: is this reply template Hinglish/Hindi vs English? */
const HI_TEMPLATE_MARKERS =
  /\b(hai|hain|hoon|karo|batao|bataunga|kitna|kitne|zyada|jyada|kharch|bacha|bachaye|tumhara|tumne|maine|mera|mere|aap|namaste|abhi|pehle|kaise|kahan|sabse|wahan|jaise|hisaab|theek|sahi|poochho|poochho|add kiya|ne |ko\/pe|ho chuka|rakhna|maan ke|se cut|kaato|bachega)\b|[अ-ह]/i;

export function classifyTemplateLang(template: string): ChatLang {
  return HI_TEMPLATE_MARKERS.test(template || '') ? 'hi' : 'en';
}

/**
 * Pick a reply template matching the user's reply language.
 * English chip / English question → English template; Hindi/Hinglish → Hinglish.
 */
export function pickTemplateForLang(
  templates: string[] | undefined,
  lang: ChatLang,
): string {
  const pool = (templates || []).map(t => t.trim()).filter(Boolean);
  if (!pool.length) {
    return lang === 'en'
      ? "I couldn't find a clear answer from your data yet."
      : 'Hmm, data ke hisaab se abhi clear jawab nahi de paya.';
  }
  const matched = pool.filter(t => classifyTemplateLang(t) === lang);
  const use = matched.length ? matched : pool;
  return use[Math.floor(Math.random() * use.length)];
}

const HI_TO_EN: Record<string, string> = {
  'kya spending theek?': 'Is spending okay?',
  'save kaise?': 'How to save?',
  'kahan zyada?': 'Where am I overspending?',
  'budget bacha?': 'Budget left?',
  'maine kitna?': 'How much did I spend?',
  'partner ne kitna?': 'Partner spend?',
  'kisne kitna?': 'Who spent how much?',
  'is month kitna kharch?': 'How much this month?',
  'is month kitna?': 'How much this month?',
  'aaj kitna?': 'How much today?',
  'top category': 'Top category',
  'top merchant': 'Top merchant',
  'roz kitna avg?': 'Daily average?',
  'projected month?': 'Month-end projection?',
  'account wise?': 'By account?',
  '10 percent kaato': 'Cut 10 percent?',
  'sabse bada expense': 'Biggest expense',
  'food pe kitna?': 'How much on food?',
};

const EN_TO_HI: Record<string, string> = {
  'is spending okay?': 'Kya spending theek?',
  'how to save?': 'Save kaise?',
  'where am i overspending?': 'Kahan zyada?',
  'budget left?': 'Budget bacha?',
  'how much did i spend?': 'Maine kitna?',
  'partner ne kitna?': 'Partner spend?',
  'who spent how much?': 'Kisne kitna?',
  'how much this month?': 'Is month kitna kharch?',
  'how much today?': 'Aaj kitna?',
  'top category': 'Top category',
  'top merchant': 'Top merchant',
  'daily average?': 'Roz kitna avg?',
  'month-end projection?': 'Projected month?',
  'by account?': 'Account wise?',
  'cut 10 percent?': '10 percent kaato',
  'biggest expense': 'Sabse bada expense',
  'how much on food?': 'Food pe kitna?',
};

export function localizeChips(chips: string[], lang: ChatLang): string[] {
  return chips.map(c => {
    const key = c.trim().toLowerCase();
    if (lang === 'en') return HI_TO_EN[key] || c;
    return EN_TO_HI[key] || c;
  });
}

export const FALLBACK_CHIPS_BY_LANG: Record<ChatLang, string[]> = {
  en: ['Is spending okay?', 'How to save?', 'Where am I overspending?', 'Budget left?'],
  hi: ['Kya spending theek?', 'Save kaise?', 'Kahan zyada?', 'Budget bacha?'],
};

export function pickLocalizedChips(
  chips: string[] | undefined,
  lang: ChatLang,
  fallback?: string[],
): string[] {
  const base = chips?.length ? chips : fallback || FALLBACK_CHIPS_BY_LANG[lang];
  return localizeChips(base, lang);
}

export function hasExplicitPeriod(text: string): boolean {
  const t = text.toLowerCase();
  for (const key of Object.keys(PERIOD_SYNONYMS) as (keyof typeof PERIOD_SYNONYMS)[]) {
    if (textIncludesAny(t, PERIOD_SYNONYMS[key])) return true;
  }
  return false;
}
