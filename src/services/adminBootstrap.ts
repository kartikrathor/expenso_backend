import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { GlobalCategory } from '../models/Category';

const SYSTEM_CATEGORIES = [
  { slug: 'food', label: 'Food', labelHi: 'खाना', emoji: '🍔', color: '#F472B6', synonyms: ['khana', 'food', 'restaurant'] },
  { slug: 'groceries', label: 'Groceries', labelHi: 'किराना', emoji: '🛒', color: '#10B981', synonyms: ['kirana', 'grocery'] },
  { slug: 'shopping', label: 'Shopping', labelHi: 'खरीदारी', emoji: '🛍️', color: '#818CF8', synonyms: ['shopping', 'online'] },
  { slug: 'transport', label: 'Transport', labelHi: 'यातायात', emoji: '🚗', color: '#38BDF8', synonyms: ['cab', 'uber', 'petrol'] },
  { slug: 'entertainment', label: 'Entertainment', labelHi: 'मनोरंजन', emoji: '🎬', color: '#FBBF24', synonyms: ['movie', 'netflix'] },
  { slug: 'bills', label: 'Bills', labelHi: 'बिल', emoji: '📱', color: '#06B6D4', synonyms: ['bill', 'recharge', 'wifi', 'light', 'gas', 'electricity', 'bijli', 'current', 'rent', 'emi'] },
  { slug: 'health', label: 'Health', labelHi: 'स्वास्थ्य', emoji: '💊', color: '#F87171', synonyms: ['medicine', 'doctor'] },
  { slug: 'other', label: 'Other', labelHi: 'अन्य', emoji: '📦', color: '#94A3B8', synonyms: ['misc', 'other'] },
];

/** Insert built-in categories if missing (never overwrite admin edits). */
export async function seedGlobalCategories(): Promise<void> {
  for (const c of SYSTEM_CATEGORIES) {
    await GlobalCategory.findOneAndUpdate(
      { slug: c.slug },
      {
        $setOnInsert: {
          label: c.label,
          labelHi: c.labelHi,
          emoji: c.emoji,
          color: c.color,
          synonyms: c.synonyms,
          active: true,
          source: 'system',
        },
      },
      { upsert: true },
    );
  }
  console.log(`✅ Global categories ready (${SYSTEM_CATEGORIES.length} built-ins)`);
}

/** Ensure ADMIN_EMAIL exists as admin (create or promote). */
export async function ensureAdminUser(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const forceSyncPassword =
    (process.env.ADMIN_SYNC_PASSWORD || '').trim() === '1' ||
    (process.env.ADMIN_SYNC_PASSWORD || '').trim().toLowerCase() === 'true';

  if (!email) {
    console.warn('⚠️  ADMIN_EMAIL not set — skip admin bootstrap');
    return;
  }

  let user = await User.findOne({ email });
  if (!user) {
    if (!password || password.length < 6) {
      console.warn('⚠️  ADMIN_PASSWORD missing/short — cannot create admin user');
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    user = await User.create({
      name: 'Admin',
      email,
      passwordHash,
      avatarColor: '#6366F1',
      role: 'admin',
      lastActiveAt: new Date(),
    });
    console.log(`✅ Admin user created (${email})`);
    return;
  }

  let changed = false;
  if (user.role !== 'admin') {
    user.role = 'admin';
    changed = true;
  }
  // Only re-hash from .env when explicitly requested — otherwise every boot
  // overwrites the app login password and breaks “forgot my password” / normal use.
  if (forceSyncPassword && password && password.length >= 6) {
    user.passwordHash = await bcrypt.hash(password, 10);
    changed = true;
  }
  if (changed) {
    await user.save();
    console.log(
      forceSyncPassword
        ? `✅ Admin user ready (${email}) — role/password synced from .env`
        : `✅ Admin user ready (${email}) — role synced`,
    );
  } else {
    console.log(`✅ Admin user ready (${email})`);
  }
}
