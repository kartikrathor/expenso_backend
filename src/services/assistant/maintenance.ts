import { AssistantIntent, AssistantMiss } from '../../models/AssistantIntent';
import { AssistantLearning, LearningSource } from '../../models/AssistantLearning';
import { completeChat, hasAnyLlmKey } from './llm';

const MAX_MISSES_KEEP = Number(process.env.ASSISTANT_MISS_MAX || 800);
const MISS_MAX_AGE_DAYS = Number(process.env.ASSISTANT_MISS_DAYS || 30);

function providerToSource(provider?: string): LearningSource {
  const p = (provider || '').toLowerCase();
  if (p.includes('gemini')) return 'gemini';
  if (p.includes('groq')) return 'groq';
  if (p.includes('hugging') || p === 'hf') return 'huggingface';
  return 'system';
}

export async function logLearning(entries: {
  intentKey: string;
  intentName?: string;
  pattern: string;
  source: LearningSource;
  fromMessage?: string;
  afterIntent?: string;
  chipsShown?: string[];
}[]): Promise<void> {
  if (!entries.length) return;
  await AssistantLearning.insertMany(
    entries.map(e => ({
      intentKey: e.intentKey,
      intentName: e.intentName || e.intentKey,
      pattern: e.pattern.slice(0, 120),
      source: e.source,
      fromMessage: e.fromMessage?.slice(0, 500),
      afterIntent: e.afterIntent?.slice(0, 80),
      chipsShown: e.chipsShown?.slice(0, 12).map(c => String(c).slice(0, 80)),
    })),
  );
}

/** Delete old / excess miss logs so Mongo stays small */
export async function cleanupAssistantMisses(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - MISS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const aged = await AssistantMiss.deleteMany({ createdAt: { $lt: cutoff } });

  const total = await AssistantMiss.countDocuments();
  let trimmed = 0;
  if (total > MAX_MISSES_KEEP) {
    const overflow = total - MAX_MISSES_KEEP;
    const old = await AssistantMiss.find()
      .sort({ createdAt: 1 })
      .limit(overflow)
      .select('_id')
      .lean();
    const ids = old.map(d => d._id);
    if (ids.length) {
      const res = await AssistantMiss.deleteMany({ _id: { $in: ids } });
      trimmed = res.deletedCount || 0;
    }
  }

  return { deleted: (aged.deletedCount || 0) + trimmed };
}

function extractJson(text: string): any {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    const oStart = trimmed.indexOf('{');
    const oEnd = trimmed.lastIndexOf('}');
    if (oStart >= 0 && oEnd > oStart) {
      return JSON.parse(trimmed.slice(oStart, oEnd + 1));
    }
    throw new Error('No JSON in LLM response');
  }
}

/**
 * Take recent unique misses → ask LLM for new patterns → merge into intents.
 * Runs rarely (scheduler). Does not store large AI payloads.
 */
export async function expandPatternsFromMisses(): Promise<{
  processed: number;
  addedPatterns: number;
  provider?: string;
}> {
  if (!hasAnyLlmKey()) {
    return { processed: 0, addedPatterns: 0 };
  }

  const misses = await AssistantMiss.find()
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();

  if (misses.length < 5) {
    return { processed: 0, addedPatterns: 0 };
  }

  const uniqueMsgs = [...new Set(misses.map(m => m.message.trim().toLowerCase()))].slice(0, 25);
  const intents = await AssistantIntent.find({ active: true }).select('key name patterns').lean();
  const intentKeys = intents.map(i => `${i.key} (${i.name})`).join(', ');

  const { text, provider } = await completeChat([
    {
      role: 'system',
      content:
        'You help improve an expense chatbot. Reply with ONLY valid JSON array. ' +
        'Each item: {"intent":"<existing_intent_key>","patterns":["phrase1","phrase2"]}. ' +
        'Patterns must be short user phrases in English, Hindi, Tamil, Telugu, or Hinglish. ' +
        'Only use intent keys from the provided list. Max 6 patterns per intent. No markdown.',
    },
    {
      role: 'user',
      content:
        `Existing intents: ${intentKeys}\n\n` +
        `Missed user messages:\n${uniqueMsgs.map(m => `- ${m}`).join('\n')}\n\n` +
        'Map messages to the closest intent and suggest new trigger phrases.',
    },
  ]);

  const parsed = extractJson(text);
  const rows = Array.isArray(parsed) ? parsed : parsed?.items || parsed?.data || [];
  let addedPatterns = 0;
  const validKeys = new Set(intents.map(i => i.key));
  const learningBatch: {
    intentKey: string;
    intentName?: string;
    pattern: string;
    source: LearningSource;
    fromMessage?: string;
  }[] = [];
  const source = providerToSource(provider);

  for (const row of rows) {
    const key = String(row?.intent || '').trim();
    if (!validKeys.has(key)) continue;
    const patterns = (Array.isArray(row.patterns) ? row.patterns : [])
      .map((p: unknown) => String(p || '').trim().toLowerCase())
      .filter((p: string) => p.length >= 2 && p.length <= 80)
      .slice(0, 8);

    if (!patterns.length) continue;

    const intent = await AssistantIntent.findOne({ key });
    if (!intent) continue;
    const before = new Set((intent.patterns || []).map(p => p.toLowerCase()));
    let grew = 0;
    for (const p of patterns) {
      if (!before.has(p)) {
        intent.patterns.push(p);
        before.add(p);
        grew += 1;
        learningBatch.push({
          intentKey: key,
          intentName: intent.name,
          pattern: p,
          source,
          fromMessage: uniqueMsgs.find(m => m.includes(p) || p.includes(m.slice(0, 20))),
        });
      }
    }
    // Cap patterns per intent to avoid unbounded growth
    if (intent.patterns.length > 400) {
      intent.patterns = intent.patterns.slice(-400);
    }
    if (grew) {
      await intent.save();
      addedPatterns += grew;
    }
  }

  await logLearning(learningBatch);

  // Remove the misses we processed (keep storage small)
  const ids = misses.map(m => m._id);
  await AssistantMiss.deleteMany({ _id: { $in: ids } });

  return { processed: misses.length, addedPatterns, provider };
}
