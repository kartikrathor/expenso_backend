import { AssistantIntent } from '../../models/AssistantIntent';
import {
  BUDGET_ASK_STEMS,
  CATEGORY_SYNONYMS,
  GREETING_STEMS,
  PERIOD_SYNONYMS,
  SPEND_ASK_STEMS,
} from './lexicon';

type SeedIntent = {
  key: string;
  name: string;
  patterns: string[];
  templates: string[];
  chips?: string[];
};

function uniq(list: string[]): string[] {
  return [...new Set(list.map(s => s.trim()).filter(Boolean))];
}

/** Build "X pe kitna" style patterns for every category synonym */
function categoryAskPatterns(): string[] {
  const out: string[] = [];
  for (const words of Object.values(CATEGORY_SYNONYMS)) {
    for (const w of words.slice(0, 12)) {
      out.push(
        `${w} pe kitna`,
        `${w} kitna`,
        `${w} spent`,
        `how much on ${w}`,
        `${w} selavu`,
        `${w} kharchu`,
        `${w} खर्च`,
      );
    }
  }
  return uniq(out);
}

function periodSpendPatterns(): string[] {
  const out: string[] = [...SPEND_ASK_STEMS];
  for (const p of PERIOD_SYNONYMS.month) {
    out.push(`${p} kitna`, `${p} kharch`, `${p} spent`, `${p} selavu`, `${p} kharchu`);
  }
  for (const p of PERIOD_SYNONYMS.today) {
    out.push(`${p} kitna`, `${p} kharch`, `${p} spent`, `${p} selavu`);
  }
  for (const p of PERIOD_SYNONYMS.week) {
    out.push(`${p} kitna`, `${p} kharch`, `${p} spent`);
  }
  return uniq(out);
}

const SEED: SeedIntent[] = [
  {
    key: 'greeting',
    name: 'Greeting',
    patterns: uniq([
      ...GREETING_STEMS,
      'hi', 'hello', 'hey', 'hii', 'yo', 'whats up',
      'good morning', 'good evening', 'kaise ho',
    ]),
    templates: [
      'Hey! Main Expenso Assistant hoon — EN / हिन्दी / தமிழ் / తెలుగు samajh sakta hoon. Poochho: kitna kharch, budget, khana/food.',
      'Vanakkam / Namaskaram / Namaste 👋 Ask about spending, budget, or top category.',
    ],
    chips: ['Is month kitna kharch?', 'Budget bacha?', 'Top category'],
  },
  {
    key: 'help',
    name: 'Help',
    patterns: uniq([
      'help', 'madad', 'kya kar sakte', 'what can you do', 'options', 'guide',
      'உதவி', 'udhavi', 'సహాయం', 'sahayam', 'मदद',
    ]),
    templates: [
      'I can tell you:\n• Total spend (today / week / month)\n• Budget left\n• Top category & merchant\n• Food/khana/சாப்பாடு/భోజనం spend\n• Biggest expense\n\nTry: “is month kitna kharch” or “unavu selavu”',
    ],
    chips: ['Is month kitna kharch?', 'Budget bacha?', 'Top merchant'],
  },
  {
    key: 'total_spent',
    name: 'Total spent',
    patterns: periodSpendPatterns(),
    templates: [
      '{period} total spend is {total} ({count} transactions) — {scope}.',
      '{period} {total} spend ho chuka hai. Top: {topCategory} ({topCategoryAmount}).',
    ],
    chips: ['Budget bacha?', 'Top category', 'Aaj kitna?'],
  },
  {
    key: 'today_spent',
    name: 'Today spent',
    patterns: uniq([
      ...PERIOD_SYNONYMS.today.flatMap(p => [`${p} kitna`, `${p} kharch`, `${p} spent`, `${p} selavu`, `${p} kharchu`]),
      'today spent', 'aaj ka kharch', 'today total',
    ]),
    templates: [
      'Today spend: {todayTotal}.',
      'Aaj {todayTotal}. This month so far: {total}.',
    ],
    chips: ['Is month kitna?', 'Budget bacha?'],
  },
  {
    key: 'budget_left',
    name: 'Budget remaining',
    patterns: uniq([
      ...BUDGET_ASK_STEMS,
      'budget kitna', 'budget status', 'budget use', 'over budget',
    ]),
    templates: [
      'Monthly budget {budget}. Used {budgetUsedPct}, left {remaining}.',
      'Budget: {budget} · Used: {budgetUsedPct} · Remaining: {remaining}.',
    ],
    chips: ['Is month kitna kharch?', 'Top category'],
  },
  {
    key: 'top_category',
    name: 'Top category',
    patterns: uniq([
      'top category', 'sabse zyada category', 'kis category', 'kahan zyada',
      'zyada kahan', 'most spent category', 'highest category',
      'எங்கே அதிகம்', 'enge adhikam', 'ఎక్కడ ఎక్కువ', 'ekkada ekkuva',
      'सबसे ज्यादा',
    ]),
    templates: [
      '{period} sabse zyada {topCategory} — {topCategoryAmount}.',
      'Top category: {topCategory} ({topCategoryAmount}) of {total}.',
    ],
    chips: ['Top merchant', 'Is month kitna?', 'Food pe kitna?'],
  },
  {
    key: 'top_merchant',
    name: 'Top merchant',
    patterns: uniq([
      'top merchant', 'sabse zyada merchant', 'kis shop', 'kahan se zyada',
      'most merchant', 'konsi shop',
      'எந்த கடை', 'ఏ షాప్',
    ]),
    templates: [
      '{period} top merchant: {topMerchant} — {topMerchantAmount}.',
      'Sabse zyada {topMerchant} pe ({topMerchantAmount}).',
    ],
    chips: ['Top category', 'Sabse bada expense'],
  },
  {
    key: 'biggest_expense',
    name: 'Biggest expense',
    patterns: uniq([
      'sabse bada', 'biggest expense', 'largest expense', 'max expense',
      'sabse mehnga', 'highest transaction', 'bada kharch',
      'பெரிய செலவு', 'పెద్ద ఖర్చు',
    ]),
    templates: [
      '{period} biggest expense: {biggest}.',
      'Bada wala: {biggest}. Period total {total}.',
    ],
    chips: ['Top category', 'Is month kitna?'],
  },
  {
    key: 'by_category',
    name: 'Spend by category',
    patterns: categoryAskPatterns(),
    templates: [
      '{period} {category}: {categoryAmount}.',
      '{category} pe {categoryAmount} ({period}). Total was {total}.',
    ],
    chips: ['Top category', 'Is month kitna?'],
  },
  {
    key: 'transaction_count',
    name: 'Transaction count',
    patterns: uniq([
      'kitne transactions', 'kitni entries', 'how many expenses', 'kitne expense',
      'count expenses', 'எத்தனை', 'ఎన్ని',
    ]),
    templates: [
      '{period}: {count} transactions, total {total}.',
    ],
    chips: ['Is month kitna?', 'Top merchant'],
  },
  {
    key: 'joint_summary',
    name: 'Joint summary',
    patterns: uniq([
      'joint', 'shared', 'partner', 'dono ka', 'hamara kharch', 'joint account',
      'shared expenses', 'ஜாயிண்ட்', 'జాయింట్',
    ]),
    templates: [
      '{scope} summary — {period}: {total} ({count} entries). Top: {topCategory} ({topCategoryAmount}).',
    ],
    chips: ['Budget bacha?', 'Top merchant'],
  },
  {
    key: 'compare_hint',
    name: 'Saving tips',
    patterns: uniq([
      'kaise bachaye', 'save money', 'tips', 'kam kaise', 'saving tip', 'budget control',
      'எப்படி சேமிப்பது', 'ఎలా సేవ్',
    ]),
    templates: [
      '{period} {topCategory} is highest ({topCategoryAmount}). Cut a bit there — budget left {remaining}.',
      'Tip: {topMerchant} took {topMerchantAmount}. Watch that category.',
    ],
    chips: ['Top category', 'Budget bacha?'],
  },
];

export async function seedAssistantIntents(): Promise<void> {
  for (const item of SEED) {
    await AssistantIntent.findOneAndUpdate(
      { key: item.key },
      {
        $set: {
          name: item.name,
          patterns: item.patterns,
          templates: item.templates,
          chips: item.chips || [],
          active: true,
        },
      },
      { upsert: true, new: true },
    );
  }
  const totalPatterns = SEED.reduce((s, i) => s + i.patterns.length, 0);
  console.log(`✅ Assistant intents seeded (${SEED.length} intents, ${totalPatterns} patterns)`);
}
