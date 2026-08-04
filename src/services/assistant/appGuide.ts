/**
 * In-app how-to knowledge for Ask Expenso (local rules + LLM hints).
 * Keep steps aligned with real UI: Home · Ask · Stats · Log · Profile.
 */

import { ChatLang } from './locale';

/** Signals that the user is asking how the app works, not for spend numbers. */
export function isAppGuideQuestion(text: string): boolean {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return false;

  const howTo =
    /\b(kya hai|what is|what's|whats|how to|how do i|kaise|kese|kaisey|lagau|lagao|lagana|set karu|set karo|add kru|add karu|add karo|banao|banau|join karu|join karo|use karu|use karo|explain|guide|tutorial|setup|set up|where|kahan|kaha|open karu|navigate)\b/i.test(
      t,
    );

  const appTopic =
    /\b(joint|shared account|theme|themes|custom theme|dark mode|light mode|budget|expense|category|categories|pro|ask expenso|ask ai|app lock|pin|export|excel|pdf|profile|settings|notification|stats|insights|history|log tab|home|widget|invite code|partner)\b/i.test(
      t,
    ) ||
    /\b(joint account|theme pack|monthly budget|add expense|custom categor)\b/i.test(t);

  // Pure how-to about the product
  if (howTo && appTopic) return true;

  // Explicit app/product questions
  if (
    /\b(app me|app mein|in the app|expenso me|expenso mein|ye app|this app|app kaise|app kya)\b/i.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

export const APP_GUIDE_INTENT_KEYS = [
  'app_joint',
  'app_themes',
  'app_budget',
  'app_add_expense',
  'app_pro_ask',
  'app_profile_settings',
  'app_stats_log',
  'app_export',
  'app_notifications',
  'app_overview',
] as const;

export type AppGuideIntentKey = (typeof APP_GUIDE_INTENT_KEYS)[number];

/** Compact facts for LLM when the user asks about the product. */
export function appGuideLlmBlock(lang: ChatLang): string {
  if (lang === 'hi') {
    return (
      'App how-to (sirf jab user Expenso app ke baare me pooche — spend numbers mat gadhna):\n' +
      '• Tabs: Home, Ask, Stats, Log, Profile.\n' +
      '• Joint: Profile → Create Joint Account / invite code share; partner Join Joint Account. Home pe Shared expenses. Leave: Profile → Leave joint account.\n' +
      '• Themes: Profile → Settings → Custom themes → Browse looks (Light/Dark/System + color packs; Default free, baaki Pro).\n' +
      '• Budget: Home → Monthly Budget → + Set / Edit → amount → Save Budget.\n' +
      '• Expense: Home pe + / Quick add / hold-mic → Add Expense (Quick / Voice / Detail).\n' +
      '• Ask AI: Ask tab — Pro + daily tokens. Precise: “Need a more accurate answer”.\n' +
      '• Export / App lock: Settings me Pro features.\n' +
      'Short clear steps do; UI labels English me rehne do.'
    );
  }
  return (
    'App how-to (only when the user asks about using Expenso — do not invent spend figures):\n' +
    '• Tabs: Home, Ask, Stats, Log, Profile.\n' +
    '• Joint: Profile → Create Joint Account, share invite code; partner enters code → Join Joint Account. Shared list on Home. Leave via Profile → Leave joint account.\n' +
    '• Themes: Profile → Settings → Custom themes → Browse looks (Light/Dark/System + color packs; Default free, others Pro).\n' +
    '• Budget: Home → Monthly Budget → + Set / Edit → Save Budget.\n' +
    '• Add expense: Home + / Quick add / hold-mic → Add Expense (Quick / Voice / Detail).\n' +
    '• Ask AI: Ask tab needs Pro + daily tokens; optional “Need a more accurate answer”.\n' +
    '• Export Excel/PDF and App lock live under Settings (Pro).\n' +
    'Give short clear steps; keep button/tab labels as in the app.'
  );
}
