import { AssistantIntent, AssistantMiss } from '../../models/AssistantIntent';
import {
  computeStats,
  detectCategory,
  detectPeriod,
  ExpenseInput,
  fillTemplate,
} from './stats';

export type ChatResult = {
  reply: string;
  intent: string;
  chips: string[];
  matched: boolean;
};

function normalize(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreIntent(message: string, patterns: string[]): number {
  let best = 0;
  for (const p of patterns) {
    const pat = normalize(p);
    if (!pat) continue;
    if (message === pat) best = Math.max(best, 100);
    else if (message.includes(pat)) best = Math.max(best, 60 + Math.min(pat.length, 30));
    else {
      // token overlap
      const msgTokens = new Set(message.split(' ').filter(Boolean));
      const patTokens = pat.split(' ').filter(Boolean);
      if (patTokens.length === 0) continue;
      const hit = patTokens.filter(t => msgTokens.has(t)).length;
      const ratio = hit / patTokens.length;
      if (ratio >= 0.7) best = Math.max(best, Math.round(40 + ratio * 40));
    }
  }
  return best;
}

function pickTemplate(templates: string[]): string {
  if (!templates.length) return 'Hmm, data ke hisaab se abhi clear jawab nahi de paya.';
  return templates[Math.floor(Math.random() * templates.length)];
}

const FALLBACK_CHIPS = [
  'Is month kitna kharch?',
  'Budget bacha?',
  'Top category',
  'Aaj kitna?',
];

const EMPTY_REPLIES = [
  'Abhi is period me koi expense nahi mila. Pehle kuch add karo, phir poochho!',
  'Data empty hai — ek-do expenses add karke dobara try karo.',
];

export async function runAssistantChat(input: {
  message: string;
  userId?: string;
  expenses: ExpenseInput[];
  monthlyBudget?: number;
  isJoint?: boolean;
}): Promise<ChatResult> {
  const message = normalize(input.message || '');
  if (!message) {
    return {
      reply: 'Kuch poochho — jaise “is month kitna kharch” ya “budget bacha?”',
      intent: 'empty',
      chips: FALLBACK_CHIPS,
      matched: false,
    };
  }

  const intents = await AssistantIntent.find({ active: true }).lean();
  let bestKey = 'unknown';
  let bestScore = 0;
  let bestDoc: (typeof intents)[0] | null = null;

  for (const intent of intents) {
    const score = scoreIntent(message, intent.patterns || []);
    if (score > bestScore) {
      bestScore = score;
      bestKey = intent.key;
      bestDoc = intent;
    }
  }

  // Greeting / help can match with lower threshold
  const threshold = bestKey === 'greeting' || bestKey === 'help' ? 35 : 45;

  if (!bestDoc || bestScore < threshold) {
    await AssistantMiss.create({
      userId: input.userId,
      message: input.message.slice(0, 500),
    }).catch(() => {});

    return {
      reply:
        'Ye exact samajh nahi aaya, lekin main kharch / budget / category bata sakta hoon. Niche se try karo 👇',
      intent: 'unknown',
      chips: FALLBACK_CHIPS,
      matched: false,
    };
  }

  // Force today period for today_spent intent
  let period = detectPeriod(message);
  if (bestKey === 'today_spent') period = 'today';
  if (bestKey === 'budget_left') period = 'month';

  const categoryId =
    bestKey === 'by_category' ? detectCategory(message) : detectCategory(message);

  // If by_category but no category detected, fall back to top_category
  let intentKey = bestKey;
  let doc = bestDoc;
  if (bestKey === 'by_category' && !categoryId) {
    const top = intents.find(i => i.key === 'top_category');
    if (top) {
      intentKey = 'top_category';
      doc = top;
    }
  }

  const stats = computeStats(input.expenses || [], {
    period,
    categoryId: intentKey === 'by_category' ? categoryId : null,
    monthlyBudget: input.monthlyBudget || 0,
    isJoint: input.isJoint,
  });

  if (
    stats.count === 0 &&
    !['greeting', 'help', 'budget_left'].includes(intentKey)
  ) {
    return {
      reply: pickTemplate(EMPTY_REPLIES),
      intent: intentKey,
      chips: doc.chips?.length ? doc.chips : FALLBACK_CHIPS,
      matched: true,
    };
  }

  if (intentKey === 'budget_left' && stats.budget <= 0) {
    return {
      reply:
        'Abhi monthly budget set nahi hai. Home pe Budget me amount save karo, phir main bataunga kitna bacha hai.',
      intent: intentKey,
      chips: ['Is month kitna kharch?', 'Top category'],
      matched: true,
    };
  }

  const reply = fillTemplate(pickTemplate(doc.templates || []), stats);

  return {
    reply,
    intent: intentKey,
    chips: doc.chips?.length ? doc.chips : FALLBACK_CHIPS,
    matched: true,
  };
}
