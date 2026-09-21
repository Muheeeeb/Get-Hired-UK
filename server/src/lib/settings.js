import { prisma } from './prisma.js';

export const SETTING_KEYS = {
  /** AI Studio master prompt — runs once, invisibly, at the start of every
   *  "CV & Cover Letter" chat. Editable by the Admin Lead only. */
  aiMasterPrompt: 'ai_master_prompt',
};

export const MAX_MASTER_PROMPT_CHARS = 100_000;

export async function getSetting(key, fallback = '') {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key, value, userId = null) {
  return prisma.appSetting.upsert({
    where: { key },
    create: { key, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
}

/** The saved master prompt, trimmed. Empty string means "not configured yet". */
export async function getMasterPrompt() {
  return (await getSetting(SETTING_KEYS.aiMasterPrompt, '')).trim();
}
