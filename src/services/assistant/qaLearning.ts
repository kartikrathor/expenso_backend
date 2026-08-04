import { AssistantIntent } from '../../models/AssistantIntent';
import { AssistantQaPattern, IAssistantQaPattern } from '../../models/AssistantQaPattern';
import { AssistantLearning } from '../../models/AssistantLearning';
import { fillTemplate, formatINR, Stats } from './stats';
import { ChatLang, classifyTemplateLang } from './locale';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
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
  const head = a.slice(0, 80);

  parts.push(
    'Speak like a trusted personal finance advisor: warm, clear, complete sentences — not a raw data dump.',
  );

  if (/^[₹]|₹\s*\d|Rs\.?\s*\d/i.test(head) || /spent|kharch|total|bacha|budget/i.test(head)) {
    parts.push('Lead with the key money answer in the first sentence, then one short insight.');
  } else {
    parts.push('Put the main money answer early, then one practical tip if useful.');
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
    parts.push(
      'Match natural Hinglish with correct grammar (e.g. “Budget cross ho chuka hai”, not “Budget already cross”).',
    );
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
 * Turn a good Gemini/precise answer into a fillable rules template by
 * swapping live stat values for {placeholders}.
 */
export function answerToTemplate(answer: string, stats: Stats): string | null {
  const text = (answer || '').trim();
  if (text.length < 20) return null;

  const biggestStr = stats.biggest
    ? `${stats.biggest.merchantLabel} (${formatINR(stats.biggest.amount)})`
    : '';

  type Pair = { value: string; ph: string };
  const pairs: Pair[] = [
    { value: formatINR(stats.projectedMonth), ph: '{projectedMonth}' },
    { value: formatINR(stats.idealSpendSoFar), ph: '{idealSpendSoFar}' },
    { value: formatINR(stats.topCategoryAmount), ph: '{topCategoryAmount}' },
    { value: formatINR(stats.secondTopCategoryAmount), ph: '{secondTopCategoryAmount}' },
    { value: formatINR(stats.topMerchantAmount), ph: '{topMerchantAmount}' },
    { value: formatINR(stats.merchantAmount), ph: '{merchantAmount}' },
    { value: formatINR(stats.dateTotal || 0), ph: '{dateTotal}' },
    { value: formatINR(stats.partnerTotal), ph: '{partnerTotal}' },
    { value: formatINR(stats.myTotal), ph: '{myTotal}' },
    { value: formatINR(stats.todayTotal), ph: '{todayTotal}' },
    { value: formatINR(stats.avgPerDay), ph: '{avgPerDay}' },
    { value: formatINR(stats.avgTxn), ph: '{avgTxn}' },
    { value: formatINR(stats.dailyBudget), ph: '{dailyBudget}' },
    { value: formatINR(stats.safeDaily), ph: '{safeDaily}' },
    { value: formatINR(stats.topCut10), ph: '{topCut10}' },
    { value: formatINR(stats.topCut20), ph: '{topCut20}' },
    { value: formatINR(stats.total), ph: '{total}' },
    { value: formatINR(stats.budget), ph: '{budget}' },
    {
      value: stats.remaining != null ? formatINR(stats.remaining) : '',
      ph: '{remaining}',
    },
    { value: formatINR(stats.categoryAmount ?? 0), ph: '{categoryAmount}' },
    { value: biggestStr, ph: '{biggest}' },
  ];

  if (stats.budgetUsedPct != null) {
    pairs.push({ value: `${stats.budgetUsedPct}%`, ph: '{budgetUsedPct}' });
  }
  if (stats.topCategory) pairs.push({ value: stats.topCategory, ph: '{topCategory}' });
  if (stats.secondTopCategory) {
    pairs.push({ value: stats.secondTopCategory, ph: '{secondTopCategory}' });
  }
  if (stats.topMerchant) pairs.push({ value: stats.topMerchant, ph: '{topMerchant}' });
  if (stats.merchantQuery) pairs.push({ value: stats.merchantQuery, ph: '{merchantQuery}' });
  if (stats.partnerName && stats.partnerName !== 'Partner') {
    pairs.push({ value: stats.partnerName, ph: '{partnerName}' });
  }
  if (stats.periodLabel) pairs.push({ value: stats.periodLabel, ph: '{period}' });
  if (stats.dateLabel) pairs.push({ value: stats.dateLabel, ph: '{dateLabel}' });
  if (stats.memberSplitText && stats.memberSplitText !== '—') {
    pairs.push({ value: stats.memberSplitText, ph: '{memberSplit}' });
  }
  if (stats.groupSplitText && stats.groupSplitText !== '—') {
    pairs.push({ value: stats.groupSplitText, ph: '{groupSplit}' });
  }
  if (stats.healthVerdict) pairs.push({ value: stats.healthVerdict, ph: '{healthVerdict}' });
  pairs.push({ value: String(stats.count), ph: '{count}' });
  pairs.push({ value: String(stats.daysLeft), ph: '{daysLeft}' });
  pairs.push({ value: String(stats.merchantCount), ph: '{merchantCount}' });
  pairs.push({ value: String(stats.dateCount || 0), ph: '{dateCount}' });
  pairs.push({ value: String(stats.myCount), ph: '{myCount}' });
  pairs.push({ value: String(stats.partnerCount), ph: '{partnerCount}' });

  // Longest values first so we don't partially replace inside larger strings
  const ordered = pairs
    .filter(p => p.value && p.value !== '—' && p.value !== '₹0')
    .sort((a, b) => b.value.length - a.value.length);

  let out = text;
  let hits = 0;
  for (const { value, ph } of ordered) {
    if (!out.includes(value)) continue;
    // Avoid replacing tiny bare numbers that appear everywhere
    if (/^\d{1,2}$/.test(value) && !['{count}', '{daysLeft}', '{dayOfMonth}'].includes(ph)) {
      continue;
    }
    const next = out.split(value).join(ph);
    if (next !== out) {
      out = next;
      hits += 1;
    }
  }

  if (hits < 1 || !/\{[a-zA-Z]+\}/.test(out)) return null;
  // Must still read like a sentence, not only placeholders
  if (out.replace(/\{[a-zA-Z]+\}/g, '').trim().length < 12) return null;
  return out.slice(0, 560).trim();
}

function scorePatternAgainstMessage(messageRaw: string, patterns: string[]): number {
  const message = soften(normalize(messageRaw));
  const msgTokens = message.split(' ').filter(Boolean);
  const msgSet = new Set(msgTokens);
  let best = 0;

  for (const p of patterns) {
    const pat = soften(normalize(p));
    if (!pat) continue;
    if (message === pat) {
      best = Math.max(best, 100);
      continue;
    }
    if (message.includes(pat)) {
      best = Math.max(best, 70 + Math.min(pat.length, 25));
      continue;
    }
    if (message.length >= 10 && pat.includes(message)) {
      best = Math.max(best, 68 + Math.min(message.length, 20));
      continue;
    }
    const patTokens = pat.split(' ').filter(Boolean);
    if (!patTokens.length) continue;
    const hit = patTokens.filter(t => msgSet.has(t)).length;
    const ratioPat = hit / patTokens.length;
    if (ratioPat >= 0.6 && hit >= 2) {
      best = Math.max(best, Math.round(45 + ratioPat * 40));
    }
  }
  return best;
}

/** Map a question to the closest active intent (for teaching patterns). */
export async function resolveIntentForQuestion(
  question: string,
  hintKey?: string,
): Promise<{ key: string; name: string; score: number } | null> {
  if (hintKey) {
    const hinted = await AssistantIntent.findOne({ key: hintKey, active: true })
      .select('key name')
      .lean();
    if (hinted) return { key: hinted.key, name: hinted.name, score: 100 };
  }

  const intents = await AssistantIntent.find({ active: true })
    .select('key name patterns')
    .lean();
  let best: { key: string; name: string; score: number } | null = null;
  for (const intent of intents) {
    if (intent.key === 'greeting' || intent.key === 'help') continue;
    const score = scorePatternAgainstMessage(question, intent.patterns || []);
    if (!best || score > best.score) {
      best = { key: intent.key, name: intent.name, score };
    }
  }
  if (!best || best.score < 35) return null;
  return best;
}

/**
 * Promote a good Q→A into the local rules engine:
 * - add user question as an intent pattern (better intent match next time)
 * - add derived reply template so local replies sound like the advisor answer
 */
async function teachIntentFromQa(input: {
  question: string;
  replyTemplate: string | null;
  intentKey?: string;
  source: 'llm' | 'precise';
}): Promise<string | undefined> {
  const question = input.question.trim().slice(0, 120);
  if (question.length < 4) return undefined;

  const resolved = await resolveIntentForQuestion(question, input.intentKey);
  if (!resolved) return undefined;

  const intent = await AssistantIntent.findOne({ key: resolved.key });
  if (!intent) return undefined;

  const qNorm = question.toLowerCase();
  const before = new Set((intent.patterns || []).map(p => p.toLowerCase()));
  let grewPattern = false;
  if (!before.has(qNorm) && qNorm.length <= 120) {
    intent.patterns.push(qNorm);
    grewPattern = true;
    if (intent.patterns.length > 400) {
      intent.patterns = intent.patterns.slice(-400);
    }
  }

  let grewTemplate = false;
  if (input.replyTemplate) {
    const tpl = input.replyTemplate.slice(0, 560);
    const tplNorm = tpl.toLowerCase();
    const existing = (intent.templates || []).map(t => t.toLowerCase());
    if (!existing.includes(tplNorm)) {
      // Learned templates go to the front so pickTemplate can prefer language match
      intent.templates = [tpl, ...(intent.templates || [])].slice(0, 24);
      grewTemplate = true;
    }
  }

  if (grewPattern || grewTemplate) {
    await intent.save();
    await AssistantLearning.create({
      intentKey: intent.key,
      intentName: intent.name,
      pattern: qNorm.slice(0, 120),
      source: input.source === 'precise' ? 'gemini' : 'system',
      fromMessage: question.slice(0, 500),
      afterIntent: grewTemplate ? 'template+pattern' : 'pattern',
    }).catch(() => {});
  }

  return intent.key;
}

/**
 * After a successful Gemini/Groq/HF reply, remember keywords → style + template.
 * Precise (“Need more accurate”) is treated as a strong correction signal.
 * Fire-and-forget safe (errors logged, never thrown to chat).
 */
export async function learnFromLlmExchange(input: {
  question: string;
  answer: string;
  source: 'llm' | 'precise';
  userId?: string;
  /** Live stats used for that answer — lets us extract fillable templates */
  stats?: Stats;
  /** Optional intent already known from the chat turn */
  intentKey?: string;
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
    const replyTemplate = input.stats ? answerToTemplate(answer, input.stats) : null;
    const userId = input.userId?.trim();
    const wasCorrection = input.source === 'precise';
    const weightBump = wasCorrection ? 5 : 1;

    let intentKey = input.intentKey;
    // Teach local rules ASAP when user said the quick answer wasn't good enough
    if (wasCorrection || replyTemplate) {
      const taught = await teachIntentFromQa({
        question,
        replyTemplate,
        intentKey,
        source: input.source,
      });
      if (taught) intentKey = taught;
    }

    const existing = await AssistantQaPattern.findOne({ fingerprint });
    if (existing) {
      existing.hits += 1;
      existing.weight = Math.min(100, (existing.weight || 1) + weightBump);
      existing.lastSource = input.source;
      existing.active = true;
      if (wasCorrection) existing.wasCorrection = true;
      if (intentKey) existing.intentKey = intentKey;
      existing.questionSample = question.slice(0, 500);

      if (userId && !existing.userIds.includes(userId)) {
        existing.userIds = [...existing.userIds, userId].slice(-24);
      }
      // Refresh exemplar on precise or every few hits so style tracks better answers
      if (existing.hits === 1 || existing.hits % 3 === 0 || wasCorrection) {
        existing.styleHint = styleHint;
        existing.sampleAnswer = sampleAnswer;
        if (replyTemplate) existing.replyTemplate = replyTemplate;
        const merged = [...new Set([...existing.keywords, ...keywords])].slice(0, 16);
        existing.keywords = merged;
      }
      await existing.save();
      return;
    }

    await AssistantQaPattern.create({
      fingerprint,
      keywords,
      questionSample: question.slice(0, 500),
      styleHint,
      sampleAnswer,
      replyTemplate: replyTemplate || undefined,
      intentKey,
      wasCorrection,
      weight: weightBump,
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
      .map((p: Pick<
        IAssistantQaPattern,
        'keywords' | 'styleHint' | 'sampleAnswer' | 'weight' | 'hits' | 'wasCorrection'
      >) => {
        const overlap = (p.keywords || []).filter((k: string) => kwSet.has(k));
        const score =
          overlap.length * 10 +
          Math.min(p.weight || 0, 40) +
          Math.min(p.hits || 0, 20) +
          (p.wasCorrection ? 15 : 0);
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
      if (p.wasCorrection) {
        lines.push(
          '   Note: User previously needed a more accurate answer for this kind of question — match that better quality.',
        );
      }
      if (p.sampleAnswer) {
        lines.push(`   Tone example (amounts are placeholders): ${p.sampleAnswer}`);
      }
      return lines.join('\n');
    });

    return (
      'Learned answer style from past Gemini/accurate answers (follow structure/tone; use CURRENT stats only):\n' +
      blocks.join('\n')
    );
  } catch (err) {
    console.warn('QA hint lookup skipped:', err instanceof Error ? err.message : err);
    return '';
  }
}

/**
 * Prefer a learned Gemini/precise reply template on the local rules path
 * when this question closely matches a past good answer.
 */
export async function pickLearnedRulesReply(
  question: string,
  intentKey: string,
  stats: Stats,
  lang: ChatLang,
): Promise<string | null> {
  try {
    const keywords = extractQaKeywords(question);
    if (keywords.length < 1 && !intentKey) return null;

    // Exact repeats use the unique fingerprint index first. This stays fast as
    // learning data grows and avoids a popular broad match hiding the exact Q&A.
    const fingerprint = qaFingerprint(keywords);
    const exact = fingerprint
      ? await AssistantQaPattern.findOne({
          fingerprint,
          active: true,
          replyTemplate: { $exists: true, $nin: [null, ''] },
        }).lean()
      : null;

    const filter: Record<string, unknown> = {
      active: true,
      replyTemplate: { $exists: true, $nin: [null, ''] },
    };
    if (keywords.length >= 2) {
      filter.$or = [{ intentKey }, { keywords: { $in: keywords } }];
    } else {
      filter.intentKey = intentKey;
    }

    const candidates = exact
      ? [exact]
      : await AssistantQaPattern.find(filter)
          .sort({ weight: -1, hits: -1 })
          .limit(30)
          .lean();

    if (!candidates.length) return null;

    const kwSet = new Set(keywords);
    const scored = candidates
      .map(p => {
        const overlap = (p.keywords || []).filter((k: string) => kwSet.has(k));
        const intentBonus = p.intentKey === intentKey ? 20 : 0;
        const correctionBonus = p.wasCorrection ? 18 : 0;
        const langMatch =
          classifyTemplateLang(p.replyTemplate || '') === lang ? 12 : 0;
        const score =
          overlap.length * 12 +
          intentBonus +
          correctionBonus +
          langMatch +
          Math.min(p.weight || 0, 40) +
          Math.min(p.hits || 0, 15);
        return { p, overlap, score };
      })
      .filter(x => {
        if (x.p.intentKey === intentKey && x.p.wasCorrection) return true;
        return x.overlap.length >= 2 || (x.p.intentKey === intentKey && (x.p.weight || 0) >= 5);
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best?.p.replyTemplate) return null;
    // Require a meaningful match so we don't force wrong templates
    if (best.score < 28) return null;

    const filled = fillTemplate(best.p.replyTemplate, stats).trim();
    if (filled.length < 12 || /\{[a-zA-Z]+\}/.test(filled)) return null;

    // Soft bump so successful local reuse reinforces the pattern
    void AssistantQaPattern.updateOne(
      { _id: best.p._id },
      { $inc: { hits: 1, weight: 0.5 } },
    ).catch(() => {});

    return filled.slice(0, 800);
  } catch (err) {
    console.warn('Learned rules reply skipped:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Shared advisor voice for LLM system prompts */
export const ADVISOR_VOICE =
  'You are Expenso — a trusted personal finance advisor for India, not a spreadsheet. ' +
  'Speak in complete, natural sentences with correct grammar. ' +
  'Never dump raw fields or sound like a data report. ' +
  'Lead with the answer the user asked for, weave in ₹ figures from verified stats only, ' +
  'then add at most one short practical insight or next step when it helps. ' +
  'Understand the user intent first (total spend, budget left, category, tip, joint split, etc.) before answering. ';
