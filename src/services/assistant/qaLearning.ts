import { AssistantQaPattern, IAssistantQaPattern } from '../../models/AssistantQaPattern';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'been', 'am',
  'to', 'of', 'in', 'on', 'for', 'and', 'or', 'but', 'if', 'so', 'as', 'at',
  'my', 'me', 'i', 'we', 'you', 'your', 'our', 'it', 'its', 'this', 'that',
  'what', 'how', 'when', 'where', 'why', 'which', 'who', 'do', 'did', 'does',
  'can', 'could', 'would', 'should', 'will', 'just', 'also', 'very', 'too',
  'with', 'from', 'about', 'into', 'than', 'then', 'them', 'they', 'their',
  'please', 'pls', 'hey', 'hi', 'hello', 'ok', 'okay', 'yes', 'no', 'not',
  // Hinglish / Hindi fillers
  'hai', 'hain', 'ho', 'hua', 'hui', 'hue', 'tha', 'thi', 'the',
  'ka', 'ke', 'ki', 'ko', 'se', 'me', 'mein', 'par', 'pe', 'per',
  'ye', 'yeh', 'woh', 'wo', 'kya', 'kyu', 'kyun', 'kaise', 'kab', 'kahan',
  'kitna', 'kitni', 'kitne', 'mujhe', 'mera', 'meri', 'mere', 'apka', 'apki',
  'btao', 'batao', 'bata', 'bataiye', 'karo', 'kar', 'do', 'dena', 'dijiye',
  'abhi', 'ab', 'toh', 'to', 'bhi', 'hi', 'na', 'ya', 'aur', 'bas',
  'sawaal', 'question', 'answer', 'tell', 'show', 'give', 'need', 'want',
  'expenso', 'expense', 'expenses', 'app',
]);

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
    .replace(/\bbachi\b/g, 'bacha')
    .replace(/\bzyadaa\b/g, 'zyada')
    .replace(/\bjyada\b/g, 'zyada');
}

/** Grab meaningful keywords from a user question. */
export function extractQaKeywords(question: string): string[] {
  const tokens = soften(normalize(question))
    .split(' ')
    .filter(t => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  return [...new Set(tokens)].slice(0, 12);
}

export function qaFingerprint(keywords: string[]): string {
  return [...keywords].sort().join('|').slice(0, 200);
}

/** Scrub ₹ / numbers so samples teach tone, not stale figures. */
export function sanitizeSampleAnswer(answer: string): string {
  return answer
    .replace(/₹\s*[\d,]+(\.\d+)?/g, '₹[amount]')
    .replace(/\bRs\.?\s*[\d,]+(\.\d+)?/gi, '₹[amount]')
    .replace(/\b\d{1,3}(,\d{3})+(\.\d+)?\b/g, '[amount]')
    .replace(/\b\d+(\.\d+)?\s*%/g, '[pct]%')
    .slice(0, 400)
    .trim();
}

export function deriveStyleHint(question: string, answer: string): string {
  const parts: string[] = [];
  const q = question.trim();
  const a = answer.trim();
  const head = a.slice(0, 60);

  if (/^[₹]|₹\s*\d|Rs\.?\s*\d/i.test(head)) {
    parts.push('Lead with the key ₹ figure in the first sentence.');
  } else if (/\d/.test(head) && /₹|rs|rupees|spent|total|bacha|kharch/i.test(a.slice(0, 120))) {
    parts.push('Put the main money answer early.');
  }

  if (a.length <= 140) {
    parts.push('Keep the reply very short (1–2 sentences).');
  } else if (a.length <= 280) {
    parts.push('Keep under ~3 short sentences.');
  } else {
    parts.push('Stay concise; prefer under 80 words.');
  }

  const hinglishQ =
    /\b(hai|hain|aap|tum|aaj|kal|mahine|kharch|bacha|zyada|kitna|mera|partner|kaise|kahan|theek)\b/i.test(
      q,
    );
  if (hinglishQ) {
    parts.push('Match natural Hinglish if the user wrote that way.');
  } else if (/^[A-Za-z0-9\s₹.,?'"%:-]+$/.test(q) && q.length > 3) {
    parts.push('Reply in clear grammatical English only — no Hinglish.');
  }

  if (/\b(category|food|groceries|transport|shopping|bills|health|top|sabse|zyada)\b/i.test(a)) {
    parts.push('If useful, name the top category after the total.');
  }

  if (/\b(budget|bacha|remaining|save|saving|50\/30\/20)\b/i.test(`${q} ${a}`)) {
    parts.push('Tie the answer to budget/remaining when the question asks for it.');
  }

  parts.push('Use ONLY live verified stats for numbers — never copy sample figures.');
  return parts.join(' ');
}

/**
 * After a successful Gemini/Groq/HF reply, remember keywords → style for similar Qs.
 * Fire-and-forget safe (errors logged, never thrown to chat).
 */
export async function learnFromLlmExchange(input: {
  question: string;
  answer: string;
  source: 'llm' | 'precise';
  userId?: string;
}): Promise<void> {
  try {
    const question = (input.question || '').trim();
    const answer = (input.answer || '').trim();
    if (question.length < 4 || answer.length < 12) return;

    const keywords = extractQaKeywords(question);
    if (keywords.length < 2) return;

    const fingerprint = qaFingerprint(keywords);
    const styleHint = deriveStyleHint(question, answer);
    const sampleAnswer = sanitizeSampleAnswer(answer);
    const userId = input.userId?.trim();

    const existing = await AssistantQaPattern.findOne({ fingerprint });
    if (existing) {
      existing.hits += 1;
      existing.weight = Math.min(100, (existing.weight || 1) + 1);
      existing.lastSource = input.source;
      existing.active = true;

      if (userId && !existing.userIds.includes(userId)) {
        existing.userIds = [...existing.userIds, userId].slice(-24);
      }
      // Refresh exemplar every few hits so style tracks better answers
      if (existing.hits === 1 || existing.hits % 3 === 0 || input.source === 'precise') {
        existing.styleHint = styleHint;
        existing.sampleAnswer = sampleAnswer;
        // Merge any new keywords (rare spelling variants)
        const merged = [...new Set([...existing.keywords, ...keywords])].slice(0, 16);
        existing.keywords = merged;
      }
      await existing.save();
      return;
    }

    await AssistantQaPattern.create({
      fingerprint,
      keywords,
      styleHint,
      sampleAnswer,
      weight: 1,
      hits: 1,
      userIds: userId ? [userId] : [],
      active: true,
      lastSource: input.source,
    });
  } catch (err) {
    console.warn('QA learning skipped:', err instanceof Error ? err.message : err);
  }
}

/**
 * Build a short prompt block from active patterns that overlap this question.
 */
export async function buildQaLearningPrompt(question: string): Promise<string> {
  try {
    const keywords = extractQaKeywords(question);
    if (keywords.length < 2) return '';

    const candidates = await AssistantQaPattern.find({
      active: true,
      keywords: { $in: keywords },
    })
      .sort({ weight: -1, hits: -1 })
      .limit(25)
      .lean();

    if (!candidates.length) return '';

    const kwSet = new Set(keywords);
    const scored = candidates
      .map((p: Pick<IAssistantQaPattern, 'keywords' | 'styleHint' | 'sampleAnswer' | 'weight' | 'hits'>) => {
        const overlap = (p.keywords || []).filter((k: string) => kwSet.has(k));
        const score =
          overlap.length * 10 + Math.min(p.weight || 0, 40) + Math.min(p.hits || 0, 20);
        return { p, overlap, score };
      })
      .filter(x => x.overlap.length >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (!scored.length) return '';

    const blocks = scored.map(({ p, overlap }, i) => {
      const lines = [
        `${i + 1}) Matched keywords: ${overlap.join(', ')}`,
        `   Style: ${p.styleHint}`,
      ];
      if (p.sampleAnswer) {
        lines.push(`   Tone example (amounts are placeholders): ${p.sampleAnswer}`);
      }
      return lines.join('\n');
    });

    return (
      'Learned answer style for similar past questions (follow structure/tone; use CURRENT stats only):\n' +
      blocks.join('\n')
    );
  } catch (err) {
    console.warn('QA hint lookup skipped:', err instanceof Error ? err.message : err);
    return '';
  }
}
