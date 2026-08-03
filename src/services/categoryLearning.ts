import { CategoryTerm, ICategoryTerm } from '../models/CategoryTerm';
import { completeChat, hasAnyLlmKey } from './assistant/llm';

const VALID = new Set([
  'food',
  'groceries',
  'shopping',
  'transport',
  'entertainment',
  'bills',
  'health',
  'other',
]);

const STOP_TERMS = new Set([
  'other',
  'misc',
  'expense',
  'test',
  'unknown',
  'n/a',
  'na',
  'item',
  'stuff',
  'thing',
  'payment',
  'paid',
  'spent',
]);

/** Built-in mappings — apply immediately without waiting for user votes. */
const SEED_TERMS: Array<{ term: string; category: string }> = [
  // Bills / utilities
  { term: 'light', category: 'bills' },
  { term: 'light bill', category: 'bills' },
  { term: 'bijli', category: 'bills' },
  { term: 'bijli bill', category: 'bills' },
  { term: 'current', category: 'bills' },
  { term: 'current bill', category: 'bills' },
  { term: 'electricity', category: 'bills' },
  { term: 'electricity bill', category: 'bills' },
  { term: 'power bill', category: 'bills' },
  { term: 'gas', category: 'bills' },
  { term: 'gas bill', category: 'bills' },
  { term: 'lpg', category: 'bills' },
  { term: 'cylinder', category: 'bills' },
  { term: 'indane', category: 'bills' },
  { term: 'water bill', category: 'bills' },
  { term: 'wifi', category: 'bills' },
  { term: 'broadband', category: 'bills' },
  { term: 'internet', category: 'bills' },
  { term: 'rent', category: 'bills' },
  { term: 'kiraya', category: 'bills' },
  { term: 'emi', category: 'bills' },
  { term: 'recharge', category: 'bills' },
  { term: 'dth', category: 'bills' },
  { term: 'maintenance', category: 'bills' },
  { term: 'society maintenance', category: 'bills' },

  // Food dishes / common names
  { term: 'pizza', category: 'food' },
  { term: 'burger', category: 'food' },
  { term: 'biryani', category: 'food' },
  { term: 'dosa', category: 'food' },
  { term: 'idli', category: 'food' },
  { term: 'vada', category: 'food' },
  { term: 'sambar', category: 'food' },
  { term: 'thali', category: 'food' },
  { term: 'paratha', category: 'food' },
  { term: 'roti', category: 'food' },
  { term: 'naan', category: 'food' },
  { term: 'paneer', category: 'food' },
  { term: 'chicken', category: 'food' },
  { term: 'mutton', category: 'food' },
  { term: 'fish', category: 'food' },
  { term: 'noodles', category: 'food' },
  { term: 'pasta', category: 'food' },
  { term: 'momos', category: 'food' },
  { term: 'momo', category: 'food' },
  { term: 'chowmein', category: 'food' },
  { term: 'fried rice', category: 'food' },
  { term: 'sandwich', category: 'food' },
  { term: 'roll', category: 'food' },
  { term: 'shawarma', category: 'food' },
  { term: 'kebab', category: 'food' },
  { term: 'samosa', category: 'food' },
  { term: 'pakora', category: 'food' },
  { term: 'chai', category: 'food' },
  { term: 'coffee', category: 'food' },
  { term: 'tea', category: 'food' },
  { term: 'juice', category: 'food' },
  { term: 'lassi', category: 'food' },
  { term: 'icecream', category: 'food' },
  { term: 'ice cream', category: 'food' },
  { term: 'dessert', category: 'food' },
  { term: 'cake', category: 'food' },
  { term: 'bakery', category: 'food' },
  { term: 'khana', category: 'food' },
  { term: 'nashta', category: 'food' },
  { term: 'tiffin', category: 'food' },
  { term: 'lunch', category: 'food' },
  { term: 'dinner', category: 'food' },
  { term: 'breakfast', category: 'food' },
  { term: 'maggi', category: 'food' },
  { term: 'dominos', category: 'food' },
  { term: 'mcdonalds', category: 'food' },
  { term: 'kfc', category: 'food' },
  { term: 'starbucks', category: 'food' },
  { term: 'ccd', category: 'food' },

  // Groceries
  { term: 'sabzi', category: 'groceries' },
  { term: 'vegetable', category: 'groceries' },
  { term: 'vegetables', category: 'groceries' },
  { term: 'milk', category: 'groceries' },
  { term: 'doodh', category: 'groceries' },
  { term: 'bread', category: 'groceries' },
  { term: 'eggs', category: 'groceries' },
  { term: 'egg', category: 'groceries' },
  { term: 'atta', category: 'groceries' },
  { term: 'dal', category: 'groceries' },
  { term: 'rice', category: 'groceries' },
  { term: 'kirana', category: 'groceries' },
  { term: 'ration', category: 'groceries' },

  // Transport
  { term: 'petrol', category: 'transport' },
  { term: 'diesel', category: 'transport' },
  { term: 'cng', category: 'transport' },
  { term: 'fuel', category: 'transport' },
  { term: 'metro', category: 'transport' },
  { term: 'auto', category: 'transport' },
  { term: 'rickshaw', category: 'transport' },
  { term: 'rapido', category: 'transport' },
  { term: 'toll', category: 'transport' },
  { term: 'parking', category: 'transport' },

  // Health
  { term: 'medicine', category: 'health' },
  { term: 'dawai', category: 'health' },
  { term: 'doctor', category: 'health' },
  { term: 'hospital', category: 'health' },
  { term: 'pharmacy', category: 'health' },
  { term: 'chemist', category: 'health' },
  { term: 'gym', category: 'health' },
];

const PROMOTE_VOTES = 2; // same category by 2+ users → global
const CONFLICT_MIN_TOTAL = 3;

export function normalizeCategoryTerm(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[₹$€£]/g, ' ')
    .replace(/(?:rs\.?|inr|rupees?)/gi, ' ')
    .replace(/\d+(?:[.,]\d+)?/g, ' ')
    .replace(/[^\p{L}\p{N}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function isLearnableTerm(term: string): boolean {
  if (!term || term.length < 2) return false;
  if (STOP_TERMS.has(term)) return false;
  if (/^\d+$/.test(term)) return false;
  return true;
}

function extractTerms(merchantLabel: string, note?: string): string[] {
  const out: string[] = [];
  const label = normalizeCategoryTerm(merchantLabel);
  if (isLearnableTerm(label)) out.push(label);

  // Also learn significant single tokens from label (e.g. "home light bill" → light)
  const tokens = label.split(/\s+/).filter(t => t.length >= 3 && isLearnableTerm(t));
  for (const t of tokens) {
    if (!out.includes(t)) out.push(t);
  }

  if (note) {
    const n = normalizeCategoryTerm(note);
    if (isLearnableTerm(n) && n.length <= 40 && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 4);
}

export async function seedCategoryTerms(): Promise<void> {
  let upserts = 0;
  for (const s of SEED_TERMS) {
    const term = normalizeCategoryTerm(s.term);
    if (!term || !VALID.has(s.category)) continue;
    const res = await CategoryTerm.updateOne(
      { term },
      {
        $setOnInsert: {
          term,
          category: s.category,
          weight: 100,
          votes: [{ category: s.category, count: 50, userIds: [] }],
          source: 'seed',
          active: true,
          conflict: false,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount) upserts += 1;
  }
  console.log(
    `✅ Category terms ready (${SEED_TERMS.length} seed phrases` +
      `${upserts ? `, +${upserts} new` : ''})`,
  );
}

function winningVote(votes: ICategoryTerm['votes']) {
  if (!votes?.length) return null;
  return [...votes].sort((a, b) => b.count - a.count)[0];
}

function hasConflict(votes: ICategoryTerm['votes']): boolean {
  if (!votes || votes.length < 2) return false;
  const sorted = [...votes].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, v) => s + v.count, 0);
  if (total < CONFLICT_MIN_TOTAL) return false;
  const [a, b] = sorted;
  // Strong disagreement: second place is close or both have promote threshold
  return b.count >= PROMOTE_VOTES && a.count - b.count <= 1;
}

/**
 * User corrected an expense category — learn globally over time.
 */
export async function recordCategoryCorrection(input: {
  userId: string;
  fromCategory?: string;
  toCategory: string;
  merchantLabel?: string;
  note?: string;
}): Promise<{ learned: string[]; skipped?: string }> {
  const to = (input.toCategory || '').trim().toLowerCase();
  if (!VALID.has(to) || to === 'other') {
    return { learned: [], skipped: 'target category not learnable' };
  }
  const from = (input.fromCategory || '').trim().toLowerCase();
  if (from && from === to) return { learned: [], skipped: 'no change' };

  const terms = extractTerms(input.merchantLabel || '', input.note);
  if (!terms.length) return { learned: [], skipped: 'no term' };

  const learned: string[] = [];
  for (const term of terms) {
    let doc = await CategoryTerm.findOne({ term });
    if (!doc) {
      doc = await CategoryTerm.create({
        term,
        category: to,
        weight: 1,
        votes: [{ category: to, count: 1, userIds: [input.userId] }],
        source: 'user',
        active: false, // wait for confirmations unless seed
        conflict: false,
      });
    } else {
      // Seed terms: still allow reinforcing, but don't demote easily
      let vote = doc.votes.find(v => v.category === to);
      if (!vote) {
        vote = { category: to, count: 0, userIds: [] };
        doc.votes.push(vote);
      }
      // One vote per user per term (move vote if they change mind)
      for (const v of doc.votes) {
        const idx = v.userIds.indexOf(input.userId);
        if (idx >= 0 && v.category !== to) {
          v.userIds.splice(idx, 1);
          v.count = Math.max(0, v.count - 1);
        }
      }
      if (!vote.userIds.includes(input.userId)) {
        vote.userIds.push(input.userId);
        if (vote.userIds.length > 40) vote.userIds = vote.userIds.slice(-40);
        vote.count = vote.userIds.length;
      } else {
        vote.count = vote.userIds.length;
      }
      // Drop empty vote buckets
      doc.votes = doc.votes.filter(v => v.count > 0);
      doc.markModified('votes');
    }

    const win = winningVote(doc.votes);
    if (win) {
      doc.category = win.category;
      doc.weight = doc.source === 'seed' ? Math.max(doc.weight, 100 + win.count) : win.count;
    }

    if (hasConflict(doc.votes)) {
      doc.conflict = true;
      // Keep active with current winner until LLM resolves
    } else if (win && win.count >= PROMOTE_VOTES) {
      doc.active = true;
      doc.conflict = false;
      if (doc.source === 'user') doc.source = 'user';
    } else if (doc.source === 'seed') {
      doc.active = true;
    }

    await doc.save();
    learned.push(term);
  }

  return { learned };
}

/** Active term → category map for app parser / assistant. */
export async function getActiveCategoryTermMap(): Promise<Record<string, string>> {
  const rows = await CategoryTerm.find({ active: true }).select('term category weight').lean();
  // Longer terms first when matching — client can sort; we return plain map
  const map: Record<string, string> = {};
  const sorted = [...rows].sort((a, b) => b.term.length - a.term.length || b.weight - a.weight);
  for (const r of sorted) {
    if (!map[r.term]) map[r.term] = r.category;
  }
  return map;
}

export async function listCategoryTermsForAdmin(limit = 200) {
  return CategoryTerm.find()
    .sort({ conflict: -1, weight: -1, updatedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Resolve conflicting terms with LLM (or majority if no key).
 */
export async function resolveCategoryConflicts(limit = 8): Promise<{
  resolved: number;
  provider?: string;
}> {
  const conflicts = await CategoryTerm.find({ conflict: true }).limit(limit);
  if (!conflicts.length) return { resolved: 0 };

  let resolved = 0;
  let provider: string | undefined;

  for (const doc of conflicts) {
    const voteSummary = doc.votes
      .map(v => `${v.category}:${v.count}`)
      .sort()
      .join(', ');

    let chosen = winningVote(doc.votes)?.category || doc.category;

    if (hasAnyLlmKey()) {
      try {
        const result = await completeChat([
          {
            role: 'system',
            content:
              'You classify expense keywords into ONE category. ' +
              'Allowed categories only: food, groceries, shopping, transport, entertainment, bills, health, other. ' +
              'Reply with ONLY the category slug, nothing else.',
          },
          {
            role: 'user',
            content:
              `Keyword/phrase: "${doc.term}"\n` +
              `User votes: ${voteSummary}\n` +
              `Current winner: ${doc.category}\n` +
              'Which category should this map to globally for an Indian expense app?',
          },
        ]);
        provider = result.provider;
        const slug = result.text.trim().toLowerCase().replace(/[^a-z_]/g, '');
        if (VALID.has(slug)) chosen = slug;
      } catch {
        // keep majority
      }
    }

    doc.category = chosen;
    doc.active = chosen !== 'other';
    doc.conflict = false;
    doc.source = 'llm';
    doc.weight = Math.max(doc.weight, 10);
    doc.lastResolvedAt = new Date();
    // Boost winning vote bucket
    let vote = doc.votes.find(v => v.category === chosen);
    if (!vote) {
      doc.votes.push({ category: chosen, count: PROMOTE_VOTES, userIds: [] });
    } else {
      vote.count = Math.max(vote.count, PROMOTE_VOTES + 1);
    }
    await doc.save();
    resolved += 1;
  }

  return { resolved, provider };
}
