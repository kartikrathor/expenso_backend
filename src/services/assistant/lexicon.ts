/**
 * Multilingual lexicon for expense assistant (EN / HI / TA / TE + romanizations).
 * Used for category + period detection and seed pattern expansion.
 */

export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  food: [
    // EN
    'food', 'meal', 'lunch', 'dinner', 'breakfast', 'cafe', 'restaurant', 'snacks',
    'swiggy', 'zomato',
    // HI + roman
    'khana', 'khaana', 'khane', 'खाना', 'भोजन', 'nashta', 'jalpan',
    // TA + roman
    'unavu', 'sapadu', 'சாப்பாடு', 'உணவு', 'tiffin',
    // TE + roman
    'bhojanam', 'tinandi', 'భోజనం', 'తిండి', 'కూర',
  ],
  groceries: [
    'grocery', 'groceries', 'kirana', 'sabzi', 'vegetables', 'blinkit', 'zepto', 'bigbasket', 'instamart',
    'किराना', 'सब्जी', 'राशन', 'ration',
    'angadi', 'kai', 'காய்கறி', 'மளிகை', 'maligai',
    'కిరాణా', 'కూరగాయలు', 'బంక్',
  ],
  shopping: [
    'shop', 'shopping', 'clothes', 'myntra', 'amazon', 'flipkart', 'ajio', 'kapde', 'dress',
    'खरीदारी', 'कपड़े', 'शॉपिंग',
    'வாங்குதல்', 'துணி', 'சேலை', 'shopping',
    'షాపింగ్', 'బట్టలు', 'కొనుగోలు',
  ],
  transport: [
    'transport', 'travel', 'uber', 'ola', 'cab', 'auto', 'petrol', 'diesel', 'fuel', 'metro', 'bus', 'train',
    'यातायात', 'पेट्रोल', 'सफर', 'safar',
    'போக்குவரத்து', 'பெட்ரோல்', 'ஆட்டோ', 'பயணம்', 'payanam',
    'రవాణా', 'పెట్రోల్', 'ప్రయాణం', 'prayanam', 'ఆటో',
  ],
  entertainment: [
    'entertainment', 'movie', 'netflix', 'spotify', 'game', 'fun', 'cinema', 'ott',
    'मनोरंजन', 'फिल्म', 'सिनेमा',
    'பொழுதுபோக்கு', 'திரைப்படம்', 'சினிமா', 'padam',
    'వినోదం', 'సినిమా', 'సినిమా',
  ],
  bills: [
    'bill', 'bills', 'recharge', 'electricity', 'wifi', 'rent', 'emi', 'mobile bill', 'current bill',
    'बिल', 'किराया', 'रिचार्ज',
    'பில்', 'வாடகை', 'ரீசார்ஜ்', 'மின்சாரம்',
    'బిల్లు', 'అద్దె', 'రీఛార్జ్', 'కరెంట్',
  ],
  health: [
    'health', 'medicine', 'hospital', 'doctor', 'pharmacy', 'medical', 'clinic',
    'स्वास्थ्य', 'दवा', 'अस्पताल', 'dawai',
    'சுகாதாரம்', 'மருந்து', 'மருத்துவமனை', 'marundhu',
    'ఆరోగ్యం', 'మందు', 'ఆసుపత్రి', 'mandhu',
  ],
};

/** Period phrases across languages */
export const PERIOD_SYNONYMS: Record<'today' | 'week' | 'month' | 'year' | 'all', string[]> = {
  today: [
    'today', 'aaj', 'aj', 'आज',
    'இன்று', 'inru', 'indru',
    'ఈరోజు', 'eerouju', 'ivela', 'ఇవాళ',
  ],
  week: [
    'week', 'hafte', 'is hafte', 'this week', 'हफ्ते', 'सप्ताह',
    'வாரம்', 'vaaram', 'indha vaaram', 'இந்த வாரம்',
    'వారం', 'ee vaaram', 'ఈ వారం',
  ],
  month: [
    'month', 'mahine', 'mahina', 'is month', 'is mahine', 'महीने', 'महीना',
    'மாதம்', 'madham', 'indha madham',
    'నెల', 'nela', 'ఈ నెల',
  ],
  year: [
    'year', 'saal', 'is saal', 'this year', 'साल', 'वर्ष',
    'வருடம்', 'varudam', 'ஆண்டு',
    'సంవత్సరం', 'samvatsaram', 'ఏడాది',
  ],
  all: [
    'all', 'overall', 'sab', 'pura', 'all time', 'total history',
    'அனைத்தும்', 'ellaam',
    'అన్నీ', 'anni', 'మొత్తం',
  ],
};

/** Common “how much / spent” stems for expanding total_spent patterns */
export const SPEND_ASK_STEMS = [
  // EN
  'how much spent', 'total spent', 'spending', 'how much did i spend',
  // HI
  'kitna kharch', 'kitna spend', 'kharcha kitna', 'kitna gaya', 'kharch kitna hua',
  'कितना खर्च', 'खर्च कितना',
  // TA
  'evvalavu selavu', 'selavu ethanai', 'எவ்வளவு செலவு', 'செலவு என்ன',
  // TE
  'enta kharchu', 'entha kharchu', 'ఎంత ఖర్చు', 'ఖర్చు ఎంత', 'karchu enta',
];

export const BUDGET_ASK_STEMS = [
  'budget left', 'budget bacha', 'remaining budget', 'kitna bacha',
  'बजट बचा', 'कितना बचा',
  'பட்ஜெட் மீதம்', 'budget ethanai baki', 'மீதமுள்ள பட்ஜெட்',
  'బడ్జెట్ మిగిలింది', 'budget minganidi', 'ఎంత మిగిలింది',
];

export const GREETING_STEMS = [
  'hi', 'hello', 'hey', 'namaste', 'vanakkam', 'namaskaram',
  'வணக்கம்', 'నమస్కారం', 'नमस्ते',
];

export function textIncludesAny(text: string, keys: string[]): boolean {
  const t = text.toLowerCase();
  return keys.some(k => k && t.includes(k.toLowerCase()));
}
