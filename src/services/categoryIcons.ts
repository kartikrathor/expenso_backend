import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'categories');

export function categoryUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

export function unlinkCategoryIcon(iconUrl: string | undefined) {
  if (!iconUrl?.startsWith('/uploads/categories/')) return;
  const file = path.join(process.cwd(), iconUrl.replace(/^\//, ''));
  fs.unlink(file, () => {});
}

function uniqueIcons(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of list) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function downloadIconifySvg(
  iconKey: string,
): Promise<{ buffer: Buffer; fileName: string; iconKey: string } | null> {
  const [prefix, ...rest] = iconKey.split(':');
  const name = rest.join(':');
  if (!prefix || !name) return null;
  try {
    const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg?height=128`;
    const r = await fetch(svgUrl, {
      headers: { 'User-Agent': 'ExpensoCategoryIcon/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text.includes('<svg')) return null;
    const safe = `${Date.now()}_${prefix}_${name}`.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
    return { buffer: Buffer.from(text, 'utf8'), fileName: `${safe}.svg`, iconKey };
  } catch {
    return null;
  }
}

/**
 * Search Iconify for a related icon and download the SVG bytes.
 * Prefers lucide / mdi / tabler / phosphor sets for clean category glyphs.
 * Pass `exclude` (already-shown Iconify ids) to get the next different option.
 */
export async function fetchRelatedCategorySvg(
  query: string,
  opts?: { exclude?: string[] },
): Promise<{ buffer: Buffer; fileName: string; iconKey: string } | null> {
  const q = query.trim().replace(/[_-]+/g, ' ').slice(0, 60);
  if (!q) return null;

  const searchUrl = `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=48`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'ExpensoCategoryIcon/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!searchRes.ok) return null;

  const data = (await searchRes.json()) as { icons?: string[] };
  const icons = data.icons || [];
  if (!icons.length) return null;

  const preferred = uniqueIcons([
    ...icons.filter(i => /^(lucide|mdi|tabler|ph|heroicons|carbon):/.test(i)),
    ...icons,
  ]);

  const exclude = new Set((opts?.exclude || []).filter(Boolean));
  let pool = preferred.filter(i => !exclude.has(i));

  // All options already shown — cycle, but avoid immediately repeating the last one
  if (!pool.length) {
    const last = opts?.exclude?.[opts.exclude.length - 1];
    pool = preferred.filter(i => i !== last);
    if (!pool.length) pool = preferred;
  }

  for (const icon of pool.slice(0, 16)) {
    const downloaded = await downloadIconifySvg(icon);
    if (downloaded) return downloaded;
  }
  return null;
}

/** Search Iconify and return CDN URLs + inline SVG (for RN SvgXml — Image cannot render SVG). */
export async function searchIconifySuggestions(
  query: string,
  limit = 12,
): Promise<{ key: string; url: string; svg?: string }[]> {
  const q = query.trim().replace(/[_-]+/g, ' ').slice(0, 60);
  if (!q) return [];

  const searchUrl = `https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=48`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'ExpensoCategoryIcon/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!searchRes.ok) return [];

  const data = (await searchRes.json()) as { icons?: string[] };
  const icons = data.icons || [];
  const preferred = uniqueIcons([
    ...icons.filter(i => /^(lucide|mdi|tabler|ph|heroicons|carbon|ion|solar):/.test(i)),
    ...icons,
  ]).slice(0, limit);

  const results = await Promise.all(
    preferred.map(async key => {
      const [prefix, ...rest] = key.split(':');
      const name = rest.join(':');
      const url = `https://api.iconify.design/${prefix}/${encodeURIComponent(name)}.svg?height=96&color=%23A78BFA`;
      let svg: string | undefined;
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'ExpensoCategoryIcon/1.0' },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const text = await r.text();
          if (text.includes('<svg')) svg = text;
        }
      } catch {
        // url-only fallback
      }
      return { key, url, svg };
    }),
  );

  return results.filter(r => r.svg || r.url);
}

/** Lightweight emoji guesses from category text + a small default palette. */
export function suggestEmojisForLabel(label: string): string[] {
  const t = label.trim().toLowerCase();
  const hits: string[] = [];
  const push = (...e: string[]) => {
    for (const x of e) if (!hits.includes(x)) hits.push(x);
  };

  if (/water|पानी|bottle|aqua|h2o|mineral|droplet|drink.?water/.test(t))
    push('💧', '🌊', '🚰', '🧴', '💦');
  if (/drink|beverage|juice|soda|cold.?drink|mocktail|smoothie|शरबत/.test(t))
    push('🥤', '🧃', '🧋', '🍹');
  if (/milk|doodh|दूध/.test(t)) push('🥛', '🍼');
  if (/beer|wine|alcohol|liquor|whisky|शराब/.test(t)) push('🍺', '🍷', '🥂');
  if (/pet|dog|cat|animal|puppy|kitten|पालतू/.test(t)) push('🐾', '🐕', '🐈', '🦴');
  if (/educat|school|college|tuition|course|study|book|पढ़ाई|स्कूल/.test(t))
    push('📚', '🎓', '✏️', '📖');
  if (/travel|trip|flight|hotel|vacation|holiday|यात्रा/.test(t)) push('✈️', '🧳', '🗺️', '🏖️');
  if (/gym|fitness|sport|yoga|workout/.test(t)) push('💪', '🏋️', '🧘', '⚽');
  if (/baby|kid|child|toy|बच्चा/.test(t)) push('👶', '🧸', '🍼', '🎈');
  if (/coffee|cafe|tea|chai|चाय/.test(t)) push('☕', '🧋', '🍵');
  if (/fuel|petrol|diesel|gas|parking|पेट्रोल/.test(t)) push('⛽', '🅿️', '🚗');
  if (/phone|mobile|recharge|data|मोबाइल/.test(t)) push('📱', '📶', '☎️');
  if (/movie|netflix|ott|game|fun|सिनेमा/.test(t)) push('🎬', '🎮', '🍿');
  if (/medic|doctor|hospital|pharmacy|clinic|दवा|अस्पताल/.test(t)) push('💊', '🏥', '🩺');
  if (/salary|income|freelance|वेतन/.test(t)) push('💼', '💰', '🏦');
  if (/wedding|party|celebration|शादी/.test(t)) push('🎉', '💍', '🥂');
  if (/plant|garden|flower|पौधा/.test(t)) push('🌱', '🪴', '🌸');
  if (/car|bike|vehicle|uber|ola|गाड़ी|बाइक/.test(t)) push('🚗', '🛵', '🚕');
  if (/food|restaurant|dining|lunch|dinner|खाना|भोजन/.test(t)) push('🍔', '🍕', '🍜');
  if (/shop|cloth|fashion|amazon|खरीदारी/.test(t)) push('🛍️', '👕', '🛒');
  if (/rent|home|house|pg|किराया|घर/.test(t)) push('🏠', '🔑', '🛋️');
  if (/gift|present|उपहार/.test(t)) push('🎁', '🎀', '💝');
  if (/donate|charity|ngo|दान/.test(t)) push('🤝', '❤️', '🙏');
  if (/insur|बीमा/.test(t)) push('🛡️', '📋');
  if (/tax|gst|टैक्स/.test(t)) push('🧾', '📊');
  if (/beauty|salon|spa|care|सैलून/.test(t)) push('💇', '💅', '✨');
  if (/electric|current|बिजली|power|light/.test(t)) push('⚡', '💡', '🔌');
  if (/internet|wifi|broadband/.test(t)) push('🌐', '📶', '💻');
  if (/laundry|wash|dry.?clean/.test(t)) push('👕', '🫧', '🧺');
  if (/maid|cook|helper|servant/.test(t)) push('🧹', '🍳', '🧽');
  if (/subscription|emi|loan|sip/.test(t)) push('💳', '📅', '🏦');
  if (/snacks|chips|biscuit/.test(t)) push('🍿', '🍪', '🥨');
  if (/fruit|veg|sabzi|सब्जी/.test(t)) push('🍎', '🥬', '🥕');
  if (/medicine|tablet|syrup/.test(t)) push('💊', '💉', '🩹');
  if (/office|work|meeting/.test(t)) push('💼', '🖥️', '📎');
  if (/music|concert|spotify/.test(t)) push('🎵', '🎧', '🎸');

  push('✨', '⭐', '💜', '🔵', '🟢', '🧡', '📦', '🔖');
  return hits.slice(0, 14);
}

/** Download an image/SVG from a direct URL into category uploads. */
export async function downloadCategoryIconFromUrl(
  url: string,
): Promise<{ buffer: Buffer; fileName: string; iconKey?: string } | null> {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  const r = await fetch(trimmed, {
    headers: { 'User-Agent': 'ExpensoCategoryIcon/1.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return null;

  const ctype = (r.headers.get('content-type') || '').toLowerCase();
  const ab = await r.arrayBuffer();
  if (!ab.byteLength || ab.byteLength < 40) return null;

  let ext = 'png';
  if (ctype.includes('svg') || trimmed.toLowerCase().includes('.svg')) ext = 'svg';
  else if (ctype.includes('jpeg') || ctype.includes('jpg')) ext = 'jpg';
  else if (ctype.includes('webp')) ext = 'webp';
  else if (ctype.includes('gif')) ext = 'gif';
  else if (ctype.includes('png')) ext = 'png';

  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  return { buffer: Buffer.from(ab), fileName };
}
