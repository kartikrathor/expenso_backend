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
      'Hey! Main Expenso Assistant hoon. Poochho: kitna kharch, budget, tips, “kya spending theek hai?”, average/day.',
      'Namaste 👋 Spend, save tips, budget check, ya simple calcs — sab poochho.',
    ],
    chips: ['Kya spending theek?', 'Save kaise?', 'Roz kitna avg?'],
  },
  {
    key: 'help',
    name: 'Help',
    patterns: uniq([
      'help', 'madad', 'kya kar sakte', 'what can you do', 'options', 'guide',
      'உதவி', 'udhavi', 'సహాయం', 'sahayam', 'मदद',
    ]),
    templates: [
      'Main yeh kar sakta hoon:\n• Kitna kharch (today/week/month)\n• Budget left + kya pace theek hai\n• Kahan zyada / kahan kaato\n• Save tips + 10–20% cut estimate\n• Avg/day, projected month, safe daily\n• Joint: maine / partner / kisne kitna\n\nTry: “kahan zyada ja raha” or “paisa kaise bachaye”',
    ],
    chips: ['Kahan zyada?', 'Save kaise?', 'Kya spending theek?'],
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
    key: 'salary_budget',
    name: 'Ideal budget from salary',
    patterns: uniq([
      'salary', 'meri salary', 'my salary', 'income', 'inhand', 'in hand', 'take home',
      'budget kitna hona chahiye', 'budget kitna rakhna', 'ideal budget', 'recommended budget',
      'salary ke hisaab', 'salary se budget', 'kitna budget set', 'budget should be',
      'salary hai budget', 'earn budget', 'ctc budget', 'paycheck budget',
      'budget hona chahiye', 'kitna budget hona', 'salary budget',
    ]),
    templates: [
      'Salary amount batao (jaise “salary 50000”) — main 50/30/20 se ideal monthly budget suggest karunga.',
      'Tell me your salary figure (e.g. “salary 50k”) and I’ll suggest a monthly budget using 50/30/20.',
    ],
    chips: ['Budget bacha?', 'Save kaise?', 'Kya spending theek?'],
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
    chips: ['2nd top category?', 'Top merchant', 'Is month kitna?'],
  },
  {
    key: 'second_top_category',
    name: '2nd top category',
    patterns: uniq([
      '2nd top category', 'second top category', 'second highest category',
      'dusri category', 'doosri category', '2nd sabse zyada', 'second sabse zyada',
      'number 2 category', 'no 2 category', '2nd karcha category',
      'dusre number pe category', 'second most spent',
    ]),
    templates: [
      '{period} 2nd top category: {secondTopCategory} — {secondTopCategoryAmount}. (1st is {topCategory}).',
      'Number 2: {secondTopCategory} ({secondTopCategoryAmount}). Top abhi {topCategory} hai.',
    ],
    chips: ['Top category', 'Top merchant', 'Is month kitna?'],
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
      'joint', 'shared', 'dono ka', 'hamara kharch', 'joint account',
      'shared expenses', 'ஜாயிண்ட்', 'జాయింట్', 'shared spend',
    ]),
    templates: [
      '{scope} summary — {period}: {total} ({count} entries). Split: {memberSplit}.',
    ],
    chips: ['Maine kitna?', 'Partner ne kitna?', 'Kisne kitna?'],
  },
  {
    key: 'my_spend',
    name: 'My spend in joint',
    patterns: uniq([
      'maine kitna', 'mera kharch', 'mere kharch', 'main kitna', 'i spent', 'my spend',
      'my share', 'mere se kitna', 'maine kharch', 'mera total', 'how much did i',
      'how much i spent', 'my expenses', 'sirf mera', 'only mine',
      'என்ன செலவு', 'నా ఖర్చు', 'मेरा खर्च', 'मैंने कितना',
    ]),
    templates: [
      '{period} tumhara add: {myTotal} ({myCount} entries). Joint total {total}.',
      'Tumne {period} {myTotal} add kiya. Partner/others: {partnerTotal}.',
    ],
    chips: ['Partner ne kitna?', 'Kisne kitna?', 'Is month kitna?'],
  },
  {
    key: 'partner_spend',
    name: 'Partner spend in joint',
    patterns: uniq([
      'partner ne kitna', 'usne kitna', 'partner kitna', 'partner spent', 'partner ka kharch',
      'dusre ne kitna', 'unka kharch', 'wife ne', 'husband ne', 'unhone kitna',
      'other person', 'partner share', 'partner expenses',
      'பார்ட்னர்', 'భాగస్వామి', 'पार्टनर ने कितना',
    ]),
    templates: [
      '{period} {partnerName}: {partnerTotal} ({partnerCount} entries). Tumhara: {myTotal}.',
      '{partnerName} ne {period} {partnerTotal} add kiya. Joint total {total}.',
    ],
    chips: ['Maine kitna?', 'Kisne kitna?', 'Budget bacha?'],
  },
  {
    key: 'member_split',
    name: 'Who spent how much',
    patterns: uniq([
      'kisne kitna', 'kaun kitna', 'who spent', 'who paid', 'split by person',
      'dono ka alag', 'har ek ka', 'member wise', 'by member', 'person wise',
      'kaunsa kitna', 'who added', 'contribution', 'kitna kisne',
      'யார் எவ்வளவு', 'ఎవరు ఎంత', 'किसने कितना',
    ]),
    templates: [
      '{period} member-wise: {memberSplit}. Joint total {total}.',
      'Split ({period}): {memberSplit}.',
    ],
    chips: ['Maine kitna?', 'Partner ne kitna?', 'Account wise?'],
  },
  {
    key: 'group_split',
    name: 'Spend by joint account',
    patterns: uniq([
      'account wise', 'group wise', 'kis account', 'which joint', 'har account',
      'multiple joint', 'sab accounts', 'account ka kharch', 'by account',
      'joint accounts', 'each joint', 'account split',
    ]),
    templates: [
      '{period} account-wise: {groupSplit}. Overall {total}.',
      'Joint accounts ({period}): {groupSplit}.',
    ],
    chips: ['Kisne kitna?', 'Maine kitna?', 'Is month kitna?'],
  },
  {
    key: 'where_high',
    name: 'Where spending is high',
    patterns: uniq([
      'kahan zyada', 'kahan jyada', 'zyada kahan', 'kahan ja raha', 'kahan spent',
      'sabse zyada kahan', 'leak kahan', 'waste kahan', 'kahan problem',
      'where am i spending', 'where most', 'highest spend where',
      'खर्च कहां', 'ज्यादा कहां',
    ]),
    templates: [
      '{period} sabse zyada {topCategory} ({topCategoryAmount}). Merchant side: {topMerchant} ({topMerchantAmount}). Wahan se cut shuru karo.',
      'Leak point: {topCategory} — {topCategoryAmount} of {total}. Biggest single: {biggest}.',
    ],
    chips: ['Save kaise?', '10 percent kaato', 'Kya spending theek?'],
  },
  {
    key: 'saving_tips',
    name: 'How to save',
    patterns: uniq([
      'kaise bachaye', 'paisa kaise bachaye', 'save money', 'saving tip', 'tips',
      'kam kaise', 'budget control', 'save kaise', 'kaise save', 'money saving',
      'खर्च कैसे कम', 'पैसे कैसे बचाएं', 'saving tips', 'cut cost',
      'எப்படி சேமிப்பது', 'ఎలా సేవ్',
    ]),
    templates: [
      'Tip: {topCategory} pe {topCategoryAmount} ja raha hai. 10% kaato → ~{topCut10} bachega; 20% → ~{topCut20}. {topMerchant} limit set karo.',
      'Simple plan: (1) {topCategory} track karo (2) daily max ~{safeDaily} (3) impulse buys 24h delay. Budget left {remaining}.',
    ],
    chips: ['Kahan zyada?', 'Roz kitna avg?', 'Kya spending theek?'],
  },
  {
    key: 'general_tips',
    name: 'General expense tips',
    patterns: uniq([
      'general tip', 'kya tip', 'advice do', 'suggestion', 'koi tip', 'money advice',
      'expense tip', 'financial tip', 'thodi advice', 'smart spending tip',
    ]),
    templates: [
      'Habit tip: weekly review karo — {topCategory} highest hai. Subscriptions + food delivery pe soft cap lagao. Daily safe ~{safeDaily}.',
      'Rule of thumb: needs pehle, wants baad me. Abhi {budgetUsedPct} budget use. Small wins: carry less UPI impulse, cook 2 days/week.',
    ],
    chips: ['Save kaise?', 'Budget bacha?', 'Kahan zyada?'],
  },
  {
    key: 'budget_health',
    name: 'Am I spending right',
    patterns: uniq([
      'kya spending theek', 'kya theek kharch', 'am i spending right', 'spending okay',
      'budget ke hisaab', 'on track', 'overspending', 'shi kharch', 'sahi kharch',
      'kya main sahi', 'decision', 'should i worry', 'budget check',
      'pace theek', 'kya overspend', 'healthy spending',
      'क्या सही खर्च', 'ठीक चल रहा',
    ]),
    templates: [
      '{healthVerdict} Ideal ab tak ~{idealSpendSoFar}; actual month {total}. Safe/day ab ~{safeDaily} ({daysLeft} days left).',
      '{healthVerdict} Projected month-end ~{projectedMonth} vs budget {budget}.',
    ],
    chips: ['Save kaise?', 'Roz kitna avg?', 'Budget bacha?'],
  },
  {
    key: 'daily_avg',
    name: 'Average per day',
    patterns: uniq([
      'roz kitna', 'daily average', 'avg per day', 'average day', 'per day kitna',
      'din ka average', 'daily spend', 'average spending', 'rozana average',
      'रोज कितना', 'प्रति दिन',
    ]),
    templates: [
      'Is month ab tak avg/day ~{avgPerDay} (day {dayOfMonth}/{daysInMonth}). Budget daily ideal ~{dailyBudget}.',
      'Average transaction ~{avgTxn}. Daily pace {avgPerDay}; safe remaining/day ~{safeDaily}.',
    ],
    chips: ['Projected month?', 'Kya spending theek?', 'Budget bacha?'],
  },
  {
    key: 'projected_month',
    name: 'Projected month spend',
    patterns: uniq([
      'projected', 'month end kitna', 'agar aise chala', 'forecast', 'estimate month',
      'mahine me kitna hoga', 'projected spend', 'end of month', 'prediction',
      'माह के अंत',
    ]),
    templates: [
      'Is pace pe month-end ~{projectedMonth} (avg/day {avgPerDay}). Budget {budget}, left {remaining}.',
      'Projection ~{projectedMonth}. Ideal so far {idealSpendSoFar}; actual month total {total}.',
    ],
    chips: ['Kya spending theek?', 'Save kaise?', 'Roz kitna avg?'],
  },
  {
    key: 'safe_daily',
    name: 'Safe daily spend left',
    patterns: uniq([
      'safe daily', 'roz kitna kharch kar sakta', 'daily limit', 'kitna per day bacha',
      'din bhar kitna', 'aage kitna din', 'remaining per day', 'safe spend today',
      'आज कितना खर्च',
    ]),
    templates: [
      'Ab se safe ~{safeDaily}/day for {daysLeft} days left (budget left {remaining}).',
      'Daily budget ideal {dailyBudget}; remaining pace {safeDaily}/day. Today already {todayTotal}.',
    ],
    chips: ['Budget bacha?', 'Kya spending theek?', 'Projected month?'],
  },
  {
    key: 'cut_estimate',
    name: 'Cut percent estimate',
    patterns: uniq([
      '10 percent', '20 percent', 'kaato to', 'cut 10', 'cut 20', 'agar kam karu',
      'percent kaato', 'thoda kaatu', 'reduce by', 'kam kardu to kitna',
      '10% ', '20% ',
    ]),
    templates: [
      '{topCategory} se 10% cut ≈ {topCut10} save; 20% ≈ {topCut20}. Abhi us pe {topCategoryAmount}.',
      'Easy win: {topMerchant} ({topMerchantAmount}) pe soft limit — 10–20% cut se {topCut10}–{topCut20} bachega.',
    ],
    chips: ['Save kaise?', 'Kahan zyada?', 'Kya spending theek?'],
  },
  {
    key: 'compare_hint',
    name: 'Saving tips (legacy)',
    patterns: uniq([
      'budget tip', 'control kharch', 'kharch kam',
    ]),
    templates: [
      '{period} {topCategory} highest ({topCategoryAmount}). Cut thoda — left {remaining}. Safe/day {safeDaily}.',
    ],
    chips: ['Save kaise?', 'Kahan zyada?'],
  },
];

export async function seedAssistantIntents(): Promise<void> {
  const overwrite = process.env.SEED_OVERWRITE_INTENTS === 'true';
  for (const item of SEED) {
    if (overwrite) {
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
    } else {
      // Preserve admin edits — only insert missing intents
      await AssistantIntent.findOneAndUpdate(
        { key: item.key },
        {
          $setOnInsert: {
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
  }
  const totalPatterns = SEED.reduce((s, i) => s + i.patterns.length, 0);
  console.log(
    `✅ Assistant intents seeded (${SEED.length} intents, ${totalPatterns} patterns` +
      `${overwrite ? ', overwrite=ON' : ', admin-safe'})`,
  );
}
