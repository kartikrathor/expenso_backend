import fs from 'fs';
import path from 'path';
import { GlobalMerchant } from '../models/Merchant';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'merchants');

type SeedMerchant = {
  slug: string;
  label: string;
  keywords: string[];
  category: string;
  color: string;
  bgColor: string;
  iconLetter: string;
  domain: string;
  sortOrder: number;
};

/** Brand domains — used to pull real logos (Clearbit / Google favicon fallback). */
const SEED: SeedMerchant[] = [
  {
    slug: 'blinkit',
    label: 'Blinkit',
    keywords: ['blinkit', 'blink it', 'ब्लिंकिट', 'ब्लिंक इट'],
    category: 'groceries',
    color: '#F8E71C',
    bgColor: '#1A3A2A',
    iconLetter: 'B',
    domain: 'blinkit.com',
    sortOrder: 10,
  },
  {
    slug: 'zepto',
    label: 'Zepto',
    keywords: ['zepto', 'ज़ेप्टो', 'जेप्टो'],
    category: 'groceries',
    color: '#7B2DFF',
    bgColor: '#2A1A4A',
    iconLetter: 'Z',
    domain: 'zeptonow.com',
    sortOrder: 20,
  },
  {
    slug: 'amazon',
    label: 'Amazon',
    keywords: ['amazon', 'amzn', 'अमेज़न', 'अमेजन'],
    category: 'shopping',
    color: '#FF9900',
    bgColor: '#2A2010',
    iconLetter: 'a',
    domain: 'amazon.in',
    sortOrder: 30,
  },
  {
    slug: 'flipkart',
    label: 'Flipkart',
    keywords: ['flipkart', 'flip kart', 'फ्लिपकार्ट'],
    category: 'shopping',
    color: '#2874F0',
    bgColor: '#102040',
    iconLetter: 'F',
    domain: 'flipkart.com',
    sortOrder: 40,
  },
  {
    slug: 'swiggy',
    label: 'Swiggy',
    keywords: ['swiggy', 'स्विगी'],
    category: 'food',
    color: '#FC8019',
    bgColor: '#3A2010',
    iconLetter: 'S',
    domain: 'swiggy.com',
    sortOrder: 50,
  },
  {
    slug: 'zomato',
    label: 'Zomato',
    keywords: ['zomato', 'ज़ोमैटो', 'जोमैटो'],
    category: 'food',
    color: '#E23744',
    bgColor: '#3A1018',
    iconLetter: 'Z',
    domain: 'zomato.com',
    sortOrder: 60,
  },
  {
    slug: 'myntra',
    label: 'Myntra',
    keywords: ['myntra', 'मिंत्रा'],
    category: 'shopping',
    color: '#FF3F6C',
    bgColor: '#3A1020',
    iconLetter: 'M',
    domain: 'myntra.com',
    sortOrder: 70,
  },
  {
    slug: 'uber',
    label: 'Uber',
    keywords: ['uber', 'उबर'],
    category: 'transport',
    color: '#FFFFFF',
    bgColor: '#1A1A1A',
    iconLetter: 'U',
    domain: 'uber.com',
    sortOrder: 80,
  },
  {
    slug: 'ola',
    label: 'Ola',
    keywords: ['ola', 'ओला'],
    category: 'transport',
    color: '#4CAF50',
    bgColor: '#1A3A1A',
    iconLetter: 'O',
    domain: 'olacabs.com',
    sortOrder: 90,
  },
  {
    slug: 'netflix',
    label: 'Netflix',
    keywords: ['netflix', 'नेटफ्लिक्स'],
    category: 'entertainment',
    color: '#E50914',
    bgColor: '#3A0A0A',
    iconLetter: 'N',
    domain: 'netflix.com',
    sortOrder: 100,
  },
  {
    slug: 'spotify',
    label: 'Spotify',
    keywords: ['spotify', 'स्पॉटिफाई'],
    category: 'entertainment',
    color: '#1DB954',
    bgColor: '#0A2A14',
    iconLetter: '♪',
    domain: 'spotify.com',
    sortOrder: 110,
  },
  {
    slug: 'paytm',
    label: 'Paytm',
    keywords: ['paytm', 'पेटीएम'],
    category: 'bills',
    color: '#00BAF2',
    bgColor: '#0A2840',
    iconLetter: 'P',
    domain: 'paytm.com',
    sortOrder: 120,
  },
  {
    slug: 'phonepe',
    label: 'PhonePe',
    keywords: ['phonepe', 'phone pe', 'फोनपे'],
    category: 'bills',
    color: '#5F259F',
    bgColor: '#201040',
    iconLetter: 'Pe',
    domain: 'phonepe.com',
    sortOrder: 130,
  },
];

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function fetchLogoBuffer(domain: string): Promise<{ buf: Buffer; ext: string } | null> {
  const sources = [
    `https://logo.clearbit.com/${domain}`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
  for (const url of sources) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'ExpensoLogoSeed/1.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (ctype.includes('svg')) continue; // RN Image often struggles with remote SVG
      const ab = await res.arrayBuffer();
      if (!ab.byteLength || ab.byteLength < 80) continue;
      let ext = 'png';
      if (ctype.includes('jpeg') || ctype.includes('jpg')) ext = 'jpg';
      else if (ctype.includes('webp')) ext = 'webp';
      else if (ctype.includes('ico')) ext = 'ico';
      return { buf: Buffer.from(ab), ext };
    } catch {
      // try next source
    }
  }
  return null;
}

/**
 * Ensure built-in merchants exist. Downloads brand logos into uploads/merchants
 * when missing (Clearbit → Google favicon → DuckDuckGo).
 */
export async function seedGlobalMerchants(): Promise<void> {
  ensureUploadDir();
  let created = 0;
  let logos = 0;

  for (const m of SEED) {
    let doc = await GlobalMerchant.findOne({ slug: m.slug });
    if (!doc) {
      doc = await GlobalMerchant.create({
        ...m,
        iconUrl: '',
        active: true,
      });
      created += 1;
    } else {
      // Keep keywords/labels in sync for system seeds if empty icon still
      let changed = false;
      if (!doc.domain) {
        doc.domain = m.domain;
        changed = true;
      }
      if (!doc.keywords?.length) {
        doc.keywords = m.keywords;
        changed = true;
      }
      if (changed) await doc.save();
    }

    const hasLocal = doc.iconUrl && doc.iconUrl.startsWith('/uploads/merchants/');
    const localExists =
      hasLocal &&
      fs.existsSync(path.join(process.cwd(), doc.iconUrl.replace(/^\//, '')));

    if (!localExists && m.domain) {
      const fetched = await fetchLogoBuffer(m.domain);
      if (fetched) {
        const fileName = `${m.slug}.${fetched.ext}`;
        const filePath = path.join(UPLOAD_DIR, fileName);
        fs.writeFileSync(filePath, fetched.buf);
        doc.iconUrl = `/uploads/merchants/${fileName}`;
        await doc.save();
        logos += 1;
      } else if (!doc.iconUrl) {
        // Last-resort remote URL (may work in admin browser even if download failed)
        doc.iconUrl = `https://www.google.com/s2/favicons?domain=${m.domain}&sz=128`;
        await doc.save();
      }
    }
  }

  console.log(
    `✅ Global merchants ready (${SEED.length} brands` +
      `${created ? `, +${created} new` : ''}` +
      `${logos ? `, ${logos} logos downloaded` : ''})`,
  );
}

export function merchantUploadDir() {
  return UPLOAD_DIR;
}
