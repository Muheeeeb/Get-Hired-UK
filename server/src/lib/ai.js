import { env } from '../config/env.js';

const ANTHROPIC_VERSION = '2023-06-01';
/**
 * Job descriptions arrive every 30 minutes to 2 hours, so the default 5-minute
 * cache would always be cold by the next one. The 1-hour TTL keeps the master
 * prompt (and the conversation so far) warm across that gap, which is the whole
 * point of caching it.
 */
const CACHE_1H = { type: 'ephemeral', ttl: '1h' };
/**
 * Fallback only. The model actually used comes from ANTHROPIC_MODEL or the
 * admin's dropdown; Sonnet is the default because it is what the Pro/Max
 * subscription serves, which is the output quality the studio is measured against.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
/**
 * A /v1/messages request may not exceed 32 MB, and base64 inflates bytes by ~33%,
 * so the raw PDF budget for one turn is held well under that. A document beyond
 * the budget still reaches Claude — as its extracted text rather than natively.
 */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES_PER_TURN = 18 * 1024 * 1024;
let modelCache = null;

function anthropicHeaders() {
  return {
    'content-type': 'application/json',
    'x-api-key': env.anthropicApiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
}

async function anthropicJson(path, options = {}) {
  const response = await fetch(`${env.anthropicBaseUrl}${path}`, {
    ...options,
    headers: { ...anthropicHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || `Anthropic API request failed (${response.status})`);
    err.status = response.status === 400 || response.status === 429 ? response.status : 502;
    err.publicMessage = response.status === 429
      ? 'Claude is temporarily rate-limited. Please wait a moment and try again.'
      : response.status === 400
        ? `Claude could not process this request: ${data?.error?.message || 'invalid request'}`
        : 'Claude is temporarily unavailable. Please try again.';
    throw err;
  }
  return data;
}

/** Models currently available to this Anthropic API key (cached for five minutes). */
export async function listClaudeModels() {
  if (!env.anthropicApiKey) {
    const fallback = env.anthropicModel || DEFAULT_CLAUDE_MODEL;
    return [{ id: fallback, name: fallback }];
  }
  if (modelCache?.expiresAt > Date.now()) return modelCache.models;

  const models = [];
  let afterId = '';
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ limit: '100' });
    if (afterId) query.set('after_id', afterId);
    const result = await anthropicJson(`/v1/models?${query}`);
    for (const model of result.data || []) {
      if (model?.id?.startsWith('claude-')) {
        models.push({ id: model.id, name: model.display_name || model.id, createdAt: model.created_at });
      }
    }
    if (!result.has_more || !result.last_id) break;
    afterId = result.last_id;
  }
  if (env.anthropicModel && !models.some((model) => model.id === env.anthropicModel)) {
    models.push({ id: env.anthropicModel, name: env.anthropicModel });
  }
  models.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  modelCache = { models, expiresAt: Date.now() + 300_000 };
  return models;
}

/**
 * The model used when nobody has chosen one.
 *
 * Deliberately NOT "the newest model this key can see": the studio is expected to
 * match what the team gets from Claude Pro/Max, which is Sonnet, and silently
 * switching models on an Anthropic release would also throw away every cached
 * prompt prefix (caches are model-scoped).
 */
export async function defaultClaudeModel() {
  if (env.anthropicModel) return env.anthropicModel;
  const models = await listClaudeModels();
  const ids = models.map((model) => model.id);
  return ids.find((id) => id === DEFAULT_CLAUDE_MODEL)
    || ids.find((id) => id.startsWith('claude-sonnet-5'))
    || ids.find((id) => id.startsWith('claude-sonnet'))
    || ids[0]
    || DEFAULT_CLAUDE_MODEL;
}

/**
 * Build the /v1/messages body.
 *
 * `system` is omitted entirely unless the admin has saved a master prompt — with
 * no system prompt Claude behaves exactly as it does in the Pro/Max apps, which
 * is what the team asked for. A hand-written "you are a CV writer" preamble is
 * what used to make it echo the instructions back into the document.
 */
export function buildClaudeRequest({ model, system, messages, maxTokens, cacheSystem = true }) {
  const body = { model, max_tokens: maxTokens, messages };
  if (system) {
    body.system = [{
      type: 'text',
      text: system,
      // One breakpoint at the end of the stable prefix: `tools` → `system` →
      // `messages`, so this caches the whole master prompt for an hour and every
      // later job description in the chat only pays for itself.
      ...(cacheSystem ? { cache_control: CACHE_1H } : {}),
    }];
  }
  // Newer Claude models (including Sonnet 5) reject `temperature` rather than
  // silently ignoring it, so keep the request to universally supported fields.
  return body;
}

/** Mark the final content block so the conversation so far is cached too. */
function withConversationCache(messages) {
  if (!messages.length) return messages;
  const copy = messages.map((message) => ({ ...message }));
  const last = copy[copy.length - 1];
  if (!Array.isArray(last.content)) {
    last.content = [{ type: 'text', text: last.content }];
  } else {
    last.content = last.content.map((block) => ({ ...block }));
  }
  const lastBlock = last.content[last.content.length - 1];
  if (lastBlock) lastBlock.cache_control = CACHE_1H;
  return copy;
}

async function generateWithClaude({ model, system, messages, maxTokens, cacheConversation = false }) {
  const resolvedModel = model || await defaultClaudeModel();
  const result = await anthropicJson('/v1/messages', {
    method: 'POST',
    body: JSON.stringify(buildClaudeRequest({
      model: resolvedModel,
      system,
      // Only worth a breakpoint when the prefix will be sent again. A one-shot
      // call would pay the 2x cache-write premium and never read it back.
      messages: cacheConversation ? withConversationCache(messages) : messages,
      maxTokens,
    })),
  });
  const draft = (result.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!draft) throw Object.assign(new Error('Claude returned an empty response'), { status: 502 });
  return {
    draft,
    source: 'claude',
    model: result.model || resolvedModel,
    usage: {
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      cacheCreationInputTokens: result.usage?.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: result.usage?.cache_read_input_tokens ?? 0,
    },
  };
}

export const MAX_AI_SOURCE_CHARS = 180_000;

/**
 * Turn uploaded references into Claude content blocks.
 *
 * PDFs go up as native `document` blocks — the same path claude.ai uses — so
 * layout, tables and columns survive instead of being flattened by a text
 * extractor. Word and text files have no native block type, so they are sent as
 * delimited text.
 */
export function buildAttachmentBlocks(attachments = []) {
  const blocks = [];
  const skipped = [];
  let pdfBudget = MAX_PDF_BYTES_PER_TURN;
  for (const file of attachments) {
    if (file.pdf && file.pdf.length <= Math.min(MAX_PDF_BYTES, pdfBudget)) {
      pdfBudget -= file.pdf.length;
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: file.pdf.toString('base64') },
        title: file.name,
      });
    } else if (file.text) {
      blocks.push({ type: 'text', text: `<document name="${file.name}">\n${file.text}\n</document>` });
    } else {
      // Too large to send natively AND nothing extractable — typically a big
      // scanned PDF. Say so rather than quietly leaving it out of the prompt.
      skipped.push(file.name);
    }
  }
  blocks.skipped = skipped;
  return blocks;
}

/**
 * One turn of an AI Studio chat.
 *
 * `prompt` is passed through untouched — no "Instructions:" labels, no injected
 * candidate/domain headers. Whatever the specialist types is what Claude sees,
 * which is why the reply no longer contains the prompt itself.
 */
export async function generateDocument({
  prompt, masterPrompt = '', attachments = [], history = [], model,
}) {
  const attachmentBlocks = buildAttachmentBlocks(attachments);
  const skippedFiles = attachmentBlocks.skipped || [];
  const userContent = [...attachmentBlocks, { type: 'text', text: prompt }];
  const messages = [
    ...history.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user', content: userContent },
  ];

  if (env.anthropicApiKey) {
    const result = await generateWithClaude({
      model,
      system: masterPrompt || undefined,
      maxTokens: 16_000,
      messages,
      cacheConversation: true,
    });
    return { ...result, skippedFiles };
  }

  if (env.aiApiKey) {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: env.aiApiKey, baseURL: env.aiBaseUrl });
    const flatten = (content) => (typeof content === 'string'
      ? content
      : content.filter((block) => block.type === 'text').map((block) => block.text).join('\n\n'));
    const completion = await openai.chat.completions.create({
      model: env.aiModel,
      temperature: 0.7,
      max_tokens: 4000,
      messages: [
        ...(masterPrompt ? [{ role: 'system', content: masterPrompt }] : []),
        ...messages.map((m) => ({ role: m.role, content: flatten(m.content) })),
      ],
    });
    return { draft: completion.choices[0].message.content.trim(), source: 'ai', skippedFiles };
  }

  if (!env.mockAi) {
    const err = new Error('AI assistant is not configured (set ANTHROPIC_API_KEY in server/.env)');
    err.status = 503;
    throw err;
  }
  return {
    draft: `— AI draft (offline mode) —\n\n${prompt}\n\n(Configure ANTHROPIC_API_KEY for real generations.)`,
    source: 'mock',
    skippedFiles,
  };
}

/**
 * One-shot cover letter for a named job (the "✨ Draft with AI" action).
 *
 * Unlike the studio this is not a conversation, so the job details have to be
 * stated in the message — but the instructions are written as a request rather
 * than as labelled scaffolding, because labels like "Instructions:" are what
 * the model used to copy back into the document.
 */
export async function draftCoverLetter({ clientName, jobTitle, company, domainName, masterCvText, model }) {
  const userContent = [
    `Write a cover letter for ${clientName}, applying for the ${jobTitle} role at ${company}.`,
    domainName ? `They are targeting ${domainName} roles.` : '',
    'Keep it to 250-350 words in UK English, ground every claim in the CV below, and reply with the letter itself and nothing else.',
    masterCvText ? `\nTheir CV:\n${masterCvText.slice(0, MAX_AI_SOURCE_CHARS)}` : '',
  ].filter(Boolean).join('\n');

  if (env.anthropicApiKey) {
    // No cache breakpoint: every call is a different job, so a cache entry
    // would be written at a 2x premium and never read back.
    return generateWithClaude({
      model, maxTokens: 2000, messages: [{ role: 'user', content: userContent }],
    });
  }

  if (env.aiApiKey) {
    const { default: OpenAI } = await import('openai');
    // The OpenAI SDK speaks to any OpenAI-compatible endpoint (Groq, Together, …)
    // by overriding baseURL — the key and provider never reach the browser.
    const openai = new OpenAI({ apiKey: env.aiApiKey, baseURL: env.aiBaseUrl });
    const completion = await openai.chat.completions.create({
      model: env.aiModel,
      temperature: 0.7,
      max_tokens: 700,
      messages: [{ role: 'user', content: userContent }],
    });
    return { draft: completion.choices[0].message.content.trim(), source: 'openai' };
  }

  if (!env.mockAi) {
    const err = new Error('AI assistant is not configured (set ANTHROPIC_API_KEY in server/.env)');
    err.status = 503;
    throw err;
  }

  // Deterministic local draft for demo environments.
  const highlights = (masterCvText || '')
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter((l) => l.length > 30 && l.length < 160)
    .slice(0, 3);

  const draft = [
    `Dear Hiring Manager,`,
    ``,
    `I am writing to express my strong interest in the ${jobTitle} position at ${company}. ` +
      `With a proven background in ${domainName || 'this field'}, I am confident I can contribute from day one and deliver measurable results for your team.`,
    ``,
    highlights.length
      ? `Highlights from my experience include:\n${highlights.map((h) => `• ${h}`).join('\n')}`
      : `Throughout my career I have consistently delivered high-quality work, collaborated across teams, and taken ownership of outcomes — qualities I would bring to ${company} immediately.`,
    ``,
    `I am particularly drawn to ${company} because of its reputation for excellence, and I believe the ${jobTitle} role is an ideal match for my skills and ambitions. I would welcome the opportunity to discuss how I can add value to your organisation.`,
    ``,
    `Thank you for your time and consideration.`,
    ``,
    `Yours faithfully,`,
    clientName,
  ].join('\n');

  return { draft, source: 'mock' };
}
