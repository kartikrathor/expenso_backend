import { PERIOD_SYNONYMS, textIncludesAny } from './lexicon';

export type ChatLang = 'en' | 'hi';

const HI_ROMAN = [
  'kya', 'hai', 'kitna', 'kitne', 'kharch', 'bacha', 'bachaye', 'kaise', 'kahan',
  'zyada', 'jyada', 'maine', 'mera', 'mere', 'usne', 'uska', 'dono',
  'aaj', 'paisa', 'theek', 'sahi', 'madad', 'batao', 'thoda', 'kam',
];

export function detectChatLang(text: string): ChatLang {
  const t = (text || '').trim();
  if (!t) return 'en';
  if (/[\u0900-\u097F]/.test(t)) return 'hi';
  const lower = t.toLowerCase().replace(/[^\p{L}\s]/gu, ' ');
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 'en';
  const hiHits = tokens.filter(w => HI_ROMAN.includes(w)).length;
  if (hiHits >= 2 || (hiHits >= 1 && tokens.length <= 4)) return 'hi';
  return 'en';
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
  'partner spend?': 'Partner ne kitna?',
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

/** Prefer English templates when user is in English mode — light rewrite of common Hinglish replies is optional; chips are enough for UX. */
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
