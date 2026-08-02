import { AssistantIntent } from '../../models/AssistantIntent';

type SeedIntent = {
  key: string;
  name: string;
  patterns: string[];
  templates: string[];
  chips?: string[];
};

const SEED: SeedIntent[] = [
  {
    key: 'greeting',
    name: 'Greeting',
    patterns: [
      'hi', 'hello', 'hey', 'namaste', 'hii', 'good morning', 'good evening',
      'kaise ho', 'whats up', 'yo',
    ],
    templates: [
      'Hey! Main Expenso Assistant hoon. {scope} ke numbers se jawab dunga — poocho: kitna kharch, budget, top category.',
      'Hello 👋 Kharch, budget ya merchants ke baare me kuch bhi poochho.',
    ],
    chips: ['Is month kitna kharch?', 'Budget bacha?', 'Top category'],
  },
  {
    key: 'help',
    name: 'Help',
    patterns: [
      'help', 'madad', 'kya kar sakte', 'what can you do', 'options', 'commands',
      'kaise use', 'guide',
    ],
    templates: [
      'Main ye bata sakta hoon:\n• Total kharch (aaj / week / month)\n• Budget kitna bacha\n• Top category & merchant\n• Food/shopping pe kitna gaya\n• Sabse bada expense\n\nTry: “is month kitna kharch”',
    ],
    chips: ['Is month kitna kharch?', 'Budget bacha?', 'Top merchant'],
  },
  {
    key: 'total_spent',
    name: 'Total spent',
    patterns: [
      'kitna kharch', 'total spent', 'total kharch', 'kitna spend', 'how much spent',
      'kitna gaya', 'kharcha kitna', 'spending total', 'overall kharch',
      'is month kitna', 'is mahine kitna', 'month total', 'kitna hogaya',
      'kharch kitna hua', 'spend kitna',
    ],
    templates: [
      '{period} tumhara total kharch {total} hai ({count} transactions) — {scope}.',
      '{period} {total} spend ho chuka hai. Sabse zyada {topCategory} pe ({topCategoryAmount}).',
    ],
    chips: ['Budget bacha?', 'Top category', 'Aaj kitna?'],
  },
  {
    key: 'today_spent',
    name: 'Today spent',
    patterns: [
      'aaj kitna', 'today spent', 'aaj ka kharch', 'today total', 'aj kitna',
      'aaj spend', 'today kharch',
    ],
    templates: [
      'Aaj ka kharch {todayTotal} hai.',
      'Aaj tak {todayTotal} spend hua hai. Month total abhi {total} hai.',
    ],
    chips: ['Is month kitna?', 'Budget bacha?'],
  },
  {
    key: 'budget_left',
    name: 'Budget remaining',
    patterns: [
      'budget bacha', 'kitna bacha', 'remaining budget', 'budget left',
      'budget kitna', 'bacha kitna', 'budget status', 'budget use',
      'kitna budget', 'over budget',
    ],
    templates: [
      'Monthly budget {budget} hai. Abhi {budgetUsedPct} use ho chuka, {remaining} bacha hai.',
      'Budget: {budget} · Used: {budgetUsedPct} · Remaining: {remaining}.',
    ],
    chips: ['Is month kitna kharch?', 'Top category'],
  },
  {
    key: 'top_category',
    name: 'Top category',
    patterns: [
      'top category', 'sabse zyada category', 'kis category', 'kahan zyada',
      'zyada kahan', 'category breakdown', 'kis cheez pe zyada',
      'most spent category', 'highest category',
    ],
    templates: [
      '{period} sabse zyada {topCategory} pe gaya — {topCategoryAmount}.',
      'Top category: {topCategory} ({topCategoryAmount}) out of {total}.',
    ],
    chips: ['Top merchant', 'Is month kitna?', 'Food pe kitna?'],
  },
  {
    key: 'top_merchant',
    name: 'Top merchant',
    patterns: [
      'top merchant', 'sabse zyada merchant', 'kis shop', 'kahan se zyada',
      'favorite store', 'most merchant', 'konsi shop',
    ],
    templates: [
      '{period} sabse zyada {topMerchant} pe kharch hua — {topMerchantAmount}.',
      'Top merchant: {topMerchant} ({topMerchantAmount}).',
    ],
    chips: ['Top category', 'Sabse bada expense'],
  },
  {
    key: 'biggest_expense',
    name: 'Biggest expense',
    patterns: [
      'sabse bada', 'biggest expense', 'largest expense', 'max expense',
      'sabse mehnga', 'highest transaction', 'bada kharch',
    ],
    templates: [
      '{period} sabse bada expense: {biggest}.',
      'Bada wala hit: {biggest} — total period kharch {total}.',
    ],
    chips: ['Top category', 'Is month kitna?'],
  },
  {
    key: 'by_category',
    name: 'Spend by category',
    patterns: [
      'food pe kitna', 'khana pe', 'groceries pe', 'shopping pe', 'transport pe',
      'uber pe', 'bills pe', 'health pe', 'entertainment pe',
      'category pe kitna', 'pe kitna gaya',
    ],
    templates: [
      '{period} {category} pe {categoryAmount} gaya.',
      '{category}: {categoryAmount} ({period}). Total kharch {total} tha.',
    ],
    chips: ['Top category', 'Is month kitna?'],
  },
  {
    key: 'transaction_count',
    name: 'Transaction count',
    patterns: [
      'kitne transactions', 'kitni entries', 'how many expenses', 'kitne expense',
      'count expenses', 'kitni baar',
    ],
    templates: [
      '{period} {count} transactions hain, total {total}.',
    ],
    chips: ['Is month kitna?', 'Top merchant'],
  },
  {
    key: 'joint_summary',
    name: 'Joint summary',
    patterns: [
      'joint', 'shared', 'partner', 'dono ka', 'hamara kharch', 'joint account',
      'shared expenses',
    ],
    templates: [
      'Yeh {scope} summary hai: {period} total {total} ({count} entries). Top: {topCategory} ({topCategoryAmount}).',
    ],
    chips: ['Budget bacha?', 'Top merchant'],
  },
  {
    key: 'compare_hint',
    name: 'Saving tips light',
    patterns: [
      'kaise bachaye', 'save money', 'tips', 'kam kaise', 'saving tip',
      'budget control',
    ],
    templates: [
      '{period} {topCategory} pe sabse zyada ({topCategoryAmount}) ja raha hai. Wahan thoda cut karo — budget me {remaining} bacha hai.',
      'Quick tip: {topMerchant} pe {topMerchantAmount} gaya. Us category ko track karte raho.',
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
  console.log(`✅ Assistant intents seeded (${SEED.length})`);
}
