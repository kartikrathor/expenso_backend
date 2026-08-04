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
      'Hey! I’m your Expenso advisor — ask about spend, budget left, saving tips, or whether you’re on track.',
      'Namaste! Main aapka Expenso advisor hoon — spend, budget, save tips, ya “kya spending theek?” sab poochho.',
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
      'I can help with:\n• Spend totals (today / week / month)\n• Transfers by name & spend on a date\n• Budget left, pace & saving tips\n• Joint spend: my share / partner / who spent what\n• App how-tos: joint account, themes, add expense, Pro/Ask\n\nTry: “How much this month?”, “Joint account kya hai?”, or “Themes kaise lagau?”',
      'Main yeh kar sakta hoon:\n• Kitna kharch (today/week/month)\n• Transfer by name + date-wise spend\n• Budget left, pace, save tips\n• Joint: maine / partner / kisne kitna\n• App guide: joint account, themes, expense add, Pro/Ask\n\nTry: “is month kitna”, “joint account kya hai?”, ya “themes kaise lagau?”',
    ],
    chips: ['Joint account kya hai?', 'Themes kaise?', 'Kya spending theek?'],
  },
  {
    key: 'total_spent',
    name: 'Total spent',
    patterns: periodSpendPatterns(),
    templates: [
      'Looking at {period}, you’ve spent {total} across {count} transactions. Your top category is {topCategory} at {topCategoryAmount}.',
      '{period} me aapne {total} kharch kiye hain ({count} entries). Sabse zyada {topCategory} pe gaya — {topCategoryAmount}.',
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
      'Today you’ve spent {todayTotal} so far. This month’s total is {total}.',
      'Aaj aapka kharch {todayTotal} hai. Is month ab tak total {total} ho chuka hai.',
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
      'Your monthly budget is {budget}. You’ve used {budgetUsedPct}, so {remaining} is still left to spend carefully.',
      'Aapka monthly budget {budget} hai. Ab tak {budgetUsedPct} use ho chuka hai, isliye {remaining} abhi bacha hai — dheere se use karo.',
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
      'Tell me your salary figure (e.g. “salary 50k”) and I’ll suggest a monthly budget using 50/30/20.',
      'Salary amount batao (jaise “salary 50000”) — main 50/30/20 se ideal monthly budget suggest karunga.',
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
      'For {period}, your highest category is {topCategory} at {topCategoryAmount} out of {total} total spend.',
      '{period} me sabse zyada kharch {topCategory} pe hua hai — {topCategoryAmount}, total {total} me se.',
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
      'Your second-highest category for {period} is {secondTopCategory} at {secondTopCategoryAmount}. First place is still {topCategory}.',
      '{period} me dusre number pe {secondTopCategory} hai ({secondTopCategoryAmount}). Pehle number pe {topCategory} hi hai.',
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
      'For {period}, you spent the most at {topMerchant} — {topMerchantAmount}. Worth a quick look if that feels high.',
      '{period} me sabse zyada {topMerchant} pe kharch hua ({topMerchantAmount}). Agar zyada lage to wahan soft limit socho.',
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
      'Your biggest single expense in {period} was {biggest}. Period total so far is {total}.',
      '{period} ka sabse bada expense {biggest} hai. Is period ka total {total} hai.',
    ],
    chips: ['Top category', 'Is month kitna?'],
  },
  {
    key: 'by_category',
    name: 'Spend by category',
    patterns: categoryAskPatterns(),
    templates: [
      'On {category} in {period}, you’ve spent {categoryAmount}. Overall spend in this period is {total}.',
      '{period} me {category} pe aapka kharch {categoryAmount} hai. Overall is period ka total {total} hai.',
    ],
    chips: ['Top category', 'Is month kitna?'],
  },
  {
    key: 'by_merchant',
    name: 'Transfer / pay to person or merchant',
    patterns: uniq([
      'ko kitna', 'ko kitne', 'ko send', 'ko bhej', 'ko diye', 'ko diya', 'ko transfer',
      'kitna send', 'kitne send', 'kitna bhej', 'kitne bhej', 'kitna transfer',
      'send kiye', 'send kiya', 'bhej diye', 'bhej diya', 'transfer kiye', 'transfer kiya',
      'send to', 'paid to', 'pay to', 'transfer to', 'money to',
      'maine ko kitna', 'mene ko kitna', 'how much did i send', 'how much sent to',
      'how much paid to', 'total sent to', 'paisa bhej', 'paisa send',
      'rs bhej', 'rs send', 'kitna diya', 'kitne diye',
      'ab tak kitna bhej', 'is month kitna bhej', 'aaj kitna bhej',
    ]),
    templates: [
      'In {period}, transfers/payments to “{merchantQuery}” add up to {merchantAmount} across {merchantCount} entries. Biggest was {biggest}.',
      '{period} me “{merchantQuery}” ko/pe total {merchantAmount} gaya ({merchantCount} entries). Sabse bada: {biggest}.',
    ],
    chips: ['Is month kitna?', 'Ab tak kitna?', 'Top merchant'],
  },
  {
    key: 'on_date',
    name: 'Spend on a specific date',
    patterns: uniq([
      'is date', 'us date', 'us din', 'usi din', 'that day', 'on that day',
      'tarikh ko', 'date ko', 'ko kitna hua', 'din kitna',
      'spending on', 'spent on', 'expenses on', 'kharch on',
      'kal kitna', 'yesterday spent', 'parson kitna',
      '3 august', '15 august', 'august ko', 'tarikh kitna',
      'is date ko kitna', 'us din kitna kharch', 'kisi date ko kitna',
    ]),
    templates: [
      'On {dateLabel}, you spent {dateTotal} across {dateCount} transactions. The biggest was {biggest}.',
      '{dateLabel} ko aapka kharch {dateTotal} tha ({dateCount} entries). Sabse bada: {biggest}.',
    ],
    chips: ['Is month kitna?', 'Aaj kitna?', 'Top category'],
  },
  {
    key: 'transaction_count',
    name: 'Transaction count',
    patterns: uniq([
      'kitne transactions', 'kitni entries', 'how many expenses', 'kitne expense',
      'count expenses', 'எத்தனை', 'ఎన్ని',
    ]),
    templates: [
      'In {period} you logged {count} transactions totaling {total}.',
      '{period} me {count} transactions hue, jinka total kharch {total} hai.',
    ],
    chips: ['Is month kitna?', 'Top merchant'],
  },
  {
    key: 'joint_summary',
    name: 'Joint summary',
    patterns: uniq([
      'dono ka', 'hamara kharch', 'shared expenses', 'shared spend',
      'joint summary', 'joint total', 'joint kharch', 'joint spend',
      'shared total', 'hamara total', 'joint account kitna',
      'ஜாயிண்ட்', 'జాయింట్',
    ]),
    templates: [
      'Here’s your joint summary for {period}: {total} across {count} entries. Split: {memberSplit}.',
      'Joint summary ({period}): total {total} ({count} entries). Dono ka split: {memberSplit}.',
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
      'In {period} you added {myTotal} ({myCount} entries). The joint total is {total}.',
      '{period} me aapka add {myTotal} hai ({myCount} entries). Joint total {total} hai.',
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
      'In {period}, {partnerName} added {partnerTotal} ({partnerCount} entries). Your share is {myTotal}.',
      '{period} me {partnerName} ne {partnerTotal} add kiya ({partnerCount} entries). Aapka share {myTotal} hai.',
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
      'For {period}, here’s who spent what: {memberSplit}. Joint total is {total}.',
      '{period} me kisne kitna: {memberSplit}. Joint total {total} hai.',
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
      'Account-wise for {period}: {groupSplit}. Overall you’re at {total}.',
      '{period} me account-wise kharch: {groupSplit}. Overall total {total} hai.',
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
      'In {period}, most money is going to {topCategory} ({topCategoryAmount}). Top merchant is {topMerchant} ({topMerchantAmount}) — start trimming there first.',
      '{period} me sabse zyada {topCategory} pe ja raha hai ({topCategoryAmount}). Merchant side {topMerchant} ({topMerchantAmount}) — pehle wahan se cut socho.',
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
      'Practical tip: {topCategory} is at {topCategoryAmount}. Cutting 10% saves about {topCut10}; 20% saves about {topCut20}. Set a soft limit on {topMerchant}.',
      'Practical tip: {topCategory} pe {topCategoryAmount} ja raha hai. 10% kaato to ~{topCut10} bachega; 20% pe ~{topCut20}. {topMerchant} pe soft limit set karo.',
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
      'Habit tip: review weekly — {topCategory} is highest. Cap subscriptions and food delivery. Safe daily ≈ {safeDaily}.',
      'Habit tip: weekly review karo — {topCategory} highest hai. Subscriptions + food delivery pe soft cap lagao. Daily safe ~{safeDaily}.',
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
      '{healthVerdict} Ideally you’d be around {idealSpendSoFar} by now; actual spend this month is {total}. Safe daily pace from here is about {safeDaily} ({daysLeft} days left).',
      '{healthVerdict} Ideal ab tak ~{idealSpendSoFar} hona chahiye tha; actual month {total} hai. Ab se safe/day ~{safeDaily} rakho ({daysLeft} days bache hain).',
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
      'This month so far, you’re averaging about {avgPerDay} per day (day {dayOfMonth}/{daysInMonth}). Your ideal daily budget is around {dailyBudget}.',
      'Is month ab tak avg/day ~{avgPerDay} hai (day {dayOfMonth}/{daysInMonth}). Budget ke hisaab se ideal daily ~{dailyBudget} hona chahiye.',
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
      'At this pace, month-end spend looks like about {projectedMonth} (avg {avgPerDay}/day). Budget is {budget}, with {remaining} left.',
      'Is pace pe month-end ~{projectedMonth} dikh raha hai (avg/day {avgPerDay}). Budget {budget} hai, abhi {remaining} bacha hai.',
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
      'From now, aim for about {safeDaily} per day across the {daysLeft} days left (budget remaining {remaining}).',
      'Abhi se ~{safeDaily}/day rakho — {daysLeft} days bache hain, aur budget me {remaining} bacha hai.',
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
      'If you cut 10% from {topCategory}, you’d save about {topCut10}; a 20% cut saves about {topCut20}. You’re at {topCategoryAmount} there now.',
      '{topCategory} se 10% cut karo to ~{topCut10} bachega; 20% pe ~{topCut20}. Abhi us category pe {topCategoryAmount} hai.',
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
      '{period} {topCategory} is highest ({topCategoryAmount}). Trim a bit — left {remaining}. Safe/day {safeDaily}.',
      '{period} {topCategory} highest hai ({topCategoryAmount}). Thoda kaato — bacha {remaining}. Safe/day {safeDaily}.',
    ],
    chips: ['Save kaise?', 'Kahan zyada?'],
  },
  // ─── App how-tos (no expense data needed) ───
  {
    key: 'app_joint',
    name: 'App: joint account how-to',
    patterns: uniq([
      'joint account kya hai', 'joint account kya', 'what is joint account', 'what is a joint account',
      'joint kya hai', 'joint account kaise', 'joint kaise', 'joint account kaise banaye',
      'joint account kaise banao', 'joint kaise add', 'joint account add', 'joint account create',
      'create joint', 'create joint account', 'how to create joint', 'how to join joint',
      'join joint', 'join joint account', 'joint join kaise', 'invite code', 'partner invite',
      'joint account kaise join', 'partner ko invite', 'leave joint', 'joint leave kaise',
      'shared account kya', 'shared account kaise', 'joint account setup', 'joint account guide',
      'how does joint work', 'joint account kese', 'joint account kese banaye',
      'joint account add kru', 'joint account add karu', 'joint kaise use',
    ]),
    templates: [
      'A joint account is a shared expense list with your partner.\n\nCreate: Profile → “Create Joint Account” → share the invite code (WhatsApp / More share).\nJoin: partner opens Profile → enter code → “Join Joint Account”.\nUse: Home shows Shared expenses — both can add/edit. Leave anytime from Profile → Leave joint account.',
      'Joint account matlab partner ke saath shared expense list.\n\nBanane ke liye: Profile → “Create Joint Account” → invite code share karo (WhatsApp / More).\nJoin: partner Profile pe code daale → “Join Joint Account”.\nUse: Home pe Shared expenses dikhengi — dono add/edit kar sakte ho. Leave: Profile → Leave joint account.',
    ],
    chips: ['Themes kaise?', 'Budget kaise set?', 'Maine kitna?'],
  },
  {
    key: 'app_themes',
    name: 'App: custom themes how-to',
    patterns: uniq([
      'theme kaise', 'themes kaise', 'theme kese', 'themes kese', 'custom theme', 'custom themes',
      'theme lagau', 'theme lagao', 'themes lagau', 'theme kaise lagau', 'themes kaise lagau',
      'theme kaise change', 'theme change kaise', 'dark mode kaise', 'light mode kaise',
      'how to change theme', 'how to apply theme', 'apply theme', 'change theme',
      'color pack', 'theme pack', 'appearance', 'look and feel', 'browse looks',
      'theme kahan', 'themes kahan', 'theme kaha milega', 'pro theme', 'theme settings',
    ]),
    templates: [
      'Custom themes: Profile → Settings → Custom themes → Browse looks.\n\nThere you can set Light / Dark / System, then tap a color pack (Default is free; other packs need Pro). Optional Pro extras: chart palette & gradient style. Quick Light/Dark toggle also sits on Home / Profile headers.',
      'Custom themes lagane ke liye: Profile → Settings → Custom themes → Browse looks.\n\nWahan Light / Dark / System set karo, phir color pack tap karo (Default free hai; baaki packs Pro). Pro me chart palette aur gradient style bhi milte hain. Quick Light/Dark toggle Home / Profile header pe bhi hai.',
    ],
    chips: ['Joint account kya hai?', 'Pro kya hai?', 'Budget kaise set?'],
  },
  {
    key: 'app_budget',
    name: 'App: set monthly budget',
    patterns: uniq([
      'budget kaise set', 'budget kese set', 'budget set kaise', 'budget kaise lagau',
      'how to set budget', 'set budget', 'set monthly budget', 'budget kahan set',
      'budget kaha set', 'monthly budget kaise', 'budget add kaise', 'budget kaise add',
      'budget save kaise', 'shared budget kaise', 'budget kaise banaye',
    ]),
    templates: [
      'Set budget on Home: open the Monthly Budget card → tap “+ Set” (or Edit) → enter amount (e.g. 15000) → Save Budget.\n\nIn a joint account this becomes a Shared Monthly Budget for both partners. Then Ask can answer budget left / pace questions.',
      'Budget set karne ke liye Home pe Monthly Budget card kholo → “+ Set” (ya Edit) → amount likho (jaise 15000) → Save Budget.\n\nJoint account me ye Shared Monthly Budget dono ke liye sync hota hai. Phir Ask pe “budget bacha?” poochh sakte ho.',
    ],
    chips: ['Budget bacha?', 'Expense kaise add?', 'Kya spending theek?'],
  },
  {
    key: 'app_add_expense',
    name: 'App: add expense how-to',
    patterns: uniq([
      'expense kaise add', 'expense kese add', 'add expense kaise', 'kharch kaise add',
      'how to add expense', 'how to add expenses', 'expense add karu', 'expense add kru',
      'expense kaise dale', 'expense kaise daale', 'entry kaise add', 'transaction kaise add',
      'voice se add', 'quick add kaise', 'category kaise add', 'custom category kaise',
      'new category kaise', 'expense edit kaise', 'expense delete kaise',
    ]),
    templates: [
      'Add an expense from Home: use Quick add, the + button, or hold the mic FAB.\n\nIn Add Expense you get Quick / Voice / Detail. Quick: type “Blinkit 200” → Continue → Confirm & Save. Detail: amount, merchant, category (or “New category…”). Swipe a card on Home/Log to edit or delete.',
      'Expense add karne ke liye Home pe Quick add, + button, ya mic FAB hold karo.\n\nAdd Expense me Quick / Voice / Detail milte hain. Quick: “Blinkit 200” likho → Continue → Confirm & Save. Detail me amount, merchant, category (ya “New category…”). Edit/delete: Home/Log pe card swipe karo.',
    ],
    chips: ['Budget kaise set?', 'Is month kitna?', 'Category pe kitna?'],
  },
  {
    key: 'app_pro_ask',
    name: 'App: Pro and Ask AI',
    patterns: uniq([
      'pro kya hai', 'what is pro', 'pro kaise', 'pro unlock', 'upgrade pro',
      'ask expenso kya', 'ask ai kya', 'ask kaise', 'ask tab', 'tokens kya',
      'how to use ask', 'need more accurate', 'precise answer kya', 'pro features',
      'pro me kya', 'what does pro include', 'ask ai kaise', 'daily tokens',
    ]),
    templates: [
      'Ask Expenso (Ask tab) is the AI advisor — Pro unlocks it with a daily token pool.\n\nType a question or tap chips; if a quick reply isn’t enough, tap “Need a more accurate answer”. Pro also unlocks theme packs, app lock, Stats custom date range, and Excel/PDF export. Plans are in the paywall (Monthly / Yearly / Restore).',
      'Ask Expenso (Ask tab) AI advisor hai — Pro se unlock hota hai, daily tokens ke saath.\n\nSawaal likho ya chips tap karo; agar quick reply kaafi na lage to “Need a more accurate answer” dabao. Pro me theme packs, app lock, Stats custom dates, aur Excel/PDF export bhi milte hain. Plans paywall pe hain (Monthly / Yearly / Restore).',
    ],
    chips: ['Themes kaise?', 'Joint account kya hai?', 'Budget bacha?'],
  },
  {
    key: 'app_profile_settings',
    name: 'App: profile and settings',
    patterns: uniq([
      'settings kahan', 'settings kaha', 'profile settings', 'app lock kaise',
      'pin kaise set', 'face id kaise', 'biometric kaise', 'password change kaise',
      'how to set pin', 'how to enable app lock', 'logout kaise', 'log out kaise',
      'delete data kaise', 'account delete', 'settings kaise open',
    ]),
    templates: [
      'Profile tab has your account, joint section, and Settings.\n\nSettings includes: App lock + PIN / Face ID (Pro), joint notification prefs, Export, Feedback, Custom themes, and Log out. Danger zone on Profile can Delete my all data (login stays; confirm twice).',
      'Profile tab pe account, joint section, aur Settings milte hain.\n\nSettings me: App lock + PIN / Face ID (Pro), joint notifications, Export, Feedback, Custom themes, aur Log out. Profile pe Danger zone se “Delete my all data” (login rehta hai; do baar confirm).',
    ],
    chips: ['Themes kaise?', 'Export kaise?', 'Pro kya hai?'],
  },
  {
    key: 'app_stats_log',
    name: 'App: Stats and Log tabs',
    patterns: uniq([
      'stats kya hai', 'insights kya', 'stats kaise', 'analytics kaise',
      'log tab', 'history kaise', 'history kahan', 'expenses history',
      'how to see stats', 'how to filter expenses', 'activity tab',
    ]),
    templates: [
      'Stats tab shows insights (Week / Month / Year / All). Pro unlocks period arrows and custom From–To dates.\n\nLog tab is your expense history + Activity: search, filter by period/category, then edit or delete entries.',
      'Stats tab pe insights milte hain (Week / Month / Year / All). Pro se period arrows aur custom From–To dates unlock hote hain.\n\nLog tab history + Activity hai: search, period/category filter, phir edit ya delete.',
    ],
    chips: ['Expense kaise add?', 'Pro kya hai?', 'Is month kitna?'],
  },
  {
    key: 'app_export',
    name: 'App: export Excel PDF',
    patterns: uniq([
      'export kaise', 'excel export', 'pdf export', 'export excel', 'export pdf',
      'how to export', 'download excel', 'download pdf', 'report export',
      'excel kaise', 'pdf kaise nikalu', 'data export kaise',
    ]),
    templates: [
      'Export from Profile → Settings → Export: Export Excel or Export PDF report (Pro).\n\nExcel includes your expenses (and joint rows when you’re in a joint account).',
      'Export ke liye Profile → Settings → Export: Export Excel ya Export PDF report (Pro).\n\nExcel me tumhari expenses aati hain (joint account ho to shared rows bhi).',
    ],
    chips: ['Pro kya hai?', 'Settings kahan?', 'Is month kitna?'],
  },
  {
    key: 'app_notifications',
    name: 'App: notifications',
    patterns: uniq([
      'notification kaise', 'notifications kaise', 'notify partner', 'partner notify',
      'notification settings', 'bell icon', 'notifications kahan',
      'how to turn off notifications', 'joint notification',
    ]),
    templates: [
      'Open notifications from the bell on Home. You can Read all or Clear there.\n\nIf you’re in a joint account, Profile → Settings has prefs: notify partner when you add, and notify you when partner adds.',
      'Home pe bell icon se notifications kholo — Read all / Clear milta hai.\n\nJoint account ho to Profile → Settings me prefs hain: jab tum add karo partner ko notify, aur jab partner add kare tumhe notify.',
    ],
    chips: ['Joint account kya hai?', 'Settings kahan?', 'Expense kaise add?'],
  },
  {
    key: 'app_overview',
    name: 'App: Expenso overview',
    patterns: uniq([
      'app kya hai', 'expenso kya hai', 'what is expenso', 'what can this app do',
      'app kaise use', 'app kaise chalaye', 'how to use app', 'how to use expenso',
      'app guide', 'app tutorial', 'expenso guide', 'features kya hai',
      'app me kya kya', 'ye app kya karti',
    ]),
    templates: [
      'Expenso tracks personal and joint expenses.\n\nTabs: Home (add spend + budget), Ask (AI advisor), Stats (insights), Log (history), Profile (joint, settings, themes).\nStart with: add a few expenses on Home, set Monthly Budget, then ask “Is spending okay?” on Ask.',
      'Expenso personal + joint expenses track karti hai.\n\nTabs: Home (add spend + budget), Ask (AI advisor), Stats (insights), Log (history), Profile (joint, settings, themes).\nShuruat: Home pe kuch expenses add karo, Monthly Budget set karo, phir Ask pe “kya spending theek?” poochho.',
    ],
    chips: ['Joint account kya hai?', 'Themes kaise?', 'Expense kaise add?'],
  },
];

export async function seedAssistantIntents(): Promise<void> {
  const overwrite = process.env.SEED_OVERWRITE_INTENTS === 'true';
  for (const item of SEED) {
    // App how-tos + joint_summary must refresh patterns so “joint kya hai” doesn’t hit spend summary
    const refreshPatterns =
      overwrite ||
      item.key.startsWith('app_') ||
      item.key === 'joint_summary' ||
      item.key === 'help';

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
    } else if (refreshPatterns) {
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
      // Preserve admin pattern edits — always refresh reply templates (grammar + EN/HI pairs)
      await AssistantIntent.findOneAndUpdate(
        { key: item.key },
        {
          $set: {
            templates: item.templates,
          },
          $setOnInsert: {
            name: item.name,
            patterns: item.patterns,
            chips: item.chips || [],
            active: true,
          },
        },
        { upsert: true, new: true },
      );
    }
  }
  const totalPatterns = SEED.reduce((s, i) => s + i.patterns.length, 0);
  const appGuides = SEED.filter(i => i.key.startsWith('app_')).length;
  console.log(
    `✅ Assistant intents seeded (${SEED.length} intents, ${totalPatterns} patterns, ${appGuides} app guides` +
      `${overwrite ? ', overwrite=ON' : ', templates refreshed, admin-safe patterns'})`,
  );
}
