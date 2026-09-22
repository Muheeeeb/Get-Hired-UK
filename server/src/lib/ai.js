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
 * Effort levels the studio offers, cheapest first.
 *
 * `max` is deliberately absent. These calls are not streamed, so the response
 * headers only arrive once generation is finished, and a `max`-effort turn on a
 * long CV can sit past the 5-minute HTTP header timeout and fail outright.
 * `xhigh` is already more deliberation than a CV or cover letter needs.
 */
export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
export const DEFAULT_AI_EFFORT = 'high';

/** How many web searches/fetches one turn may make. Each search is billed. */
const WEB_TOOL_MAX_USES = 6;
/**
 * A server tool can hand the turn back with `pause_turn` before Claude has
 * finished speaking. Four resumes is far more than a job-description lookup
 * needs and bounds what one /generate request can cost.
 */
const MAX_SERVER_TOOL_ROUNDS = 4;

/**
 * A /v1/messages request may not exceed 32 MB, and base64 inflates bytes by ~33%,
 * so the raw PDF budget for one turn is held well under that. A document beyond
 * the budget still reaches Claude — as its extracted text rather than natively.
 */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES_PER_TURN = 10 * 1024 * 1024;
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
 * Family and version behind a model id — `claude-opus-4-8` → `{opus, 4.8}`.
 *
 * An id this code has never seen returns null, and every check below then treats
 * it as NEWER than anything listed here. The model list is fetched live from
 * /v1/models, so a model released after this was written must pick up the better
 * tools rather than silently falling back to the older ones.
 */
function modelCapabilities(model) {
  const id = String(model || '');
  // Ids up to Claude 3 put the version before the family (`claude-3-5-sonnet-…`)
  // and predate every feature below, so classify them outright.
  if (/^claude-[0-3](?:[-.]|$)/.test(id)) return { family: 'legacy', version: 0 };
  const match = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d+))?/.exec(id);
  if (!match) return null;
  const [, family, major, minor] = match;
  return { family, version: Number(`${major}.${minor || 0}`) };
}

/** Web search and web fetch with dynamic filtering: Opus/Sonnet 4.6+ and the Fable line. */
function supportsModernWebTools(model) {
  const caps = modelCapabilities(model);
  if (!caps) return true;
  if (caps.family === 'fable' || caps.family === 'mythos') return true;
  if (caps.family === 'opus' || caps.family === 'sonnet') return caps.version >= 4.6;
  return false;
}

/**
 * Adaptive thinking and `output_config.effort`: Opus/Sonnet 4.6+ and the Fable
 * line. Haiku 4.5 and older take the retired `budget_tokens` form instead, so
 * they are left exactly as they were — no thinking, no effort — rather than
 * being sent a parameter that would 400.
 */
function supportsAdaptiveThinking(model) {
  return supportsModernWebTools(model);
}

/** `xhigh` arrived with Opus 4.7; Opus 4.6 and Sonnet 4.6 stop at `high`. */
function supportsXhighEffort(model) {
  const caps = modelCapabilities(model);
  if (!caps) return true;
  if (caps.family === 'fable' || caps.family === 'mythos') return true;
  if (caps.family === 'opus') return caps.version >= 4.7;
  if (caps.family === 'sonnet') return caps.version >= 5;
  return false;
}

/**
 * The web tools, in a shape that is identical on every request of a chat.
 *
 * `tools` renders ahead of `system` in the cached prefix, so anything that
 * varied here — a changing `max_uses`, a reordered list — would throw away the
 * master-prompt cache on every single turn.
 */
function webToolsFor(model) {
  const modern = supportsModernWebTools(model);
  return [
    {
      type: modern ? 'web_search_20260209' : 'web_search_20250305',
      name: 'web_search',
      max_uses: WEB_TOOL_MAX_USES,
    },
    {
      type: modern ? 'web_fetch_20260209' : 'web_fetch_20250910',
      name: 'web_fetch',
      max_uses: WEB_TOOL_MAX_USES,
    },
  ];
}

export function normaliseEffort(effort) {
  return AI_EFFORTS.includes(effort) ? effort : DEFAULT_AI_EFFORT;
}

/** The effort to ask for, downgraded rather than rejected on models without `xhigh`. */
export function resolveEffort(model, effort) {
  const wanted = AI_EFFORTS.includes(effort) ? effort : DEFAULT_AI_EFFORT;
  if (wanted === 'xhigh' && !supportsXhighEffort(model)) return 'high';
  return wanted;
}

/**
 * Build the /v1/messages body.
 *
 * `system` is omitted entirely unless the admin has saved a master prompt — with
 * no system prompt Claude behaves exactly as it does in the Pro/Max apps, which
 * is what the team asked for. A hand-written "you are a CV writer" preamble is
 * what used to make it echo the instructions back into the document.
 *
 * `webTools` and `thinking` are what close the remaining gap with the Pro/Max
 * apps: over the raw API Claude gets no tools unless they are declared, which is
 * why the studio used to answer "I can't browse the internet" to a question the
 * browser answered from a live search.
 */
export function buildClaudeRequest({
  model, system, messages, maxTokens, cacheSystem = true, webTools = false, effort,
}) {
  const body = { model, max_tokens: maxTokens };
  if (webTools) body.tools = webToolsFor(model);
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
  if (supportsAdaptiveThinking(model)) {
    // `summarized` is an opt-in: the default returns thinking blocks with empty
    // text, which would show the user an empty "Thought process" panel.
    body.thinking = { type: 'adaptive', display: 'summarized' };
    // Note `effort` lives inside output_config — a top-level `effort` is ignored.
    body.output_config = { effort: resolveEffort(model, effort) };
  }
  body.messages = messages;
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

const WEB_RESULT_TYPES = new Set(['web_search_tool_result', 'web_fetch_tool_result']);

/** The pages Claude actually opened, so a reply can show its working as claude.ai does. */
function collectSources(blocks) {
  const seen = new Map();
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item?.url && !seen.has(item.url)) {
          seen.set(item.url, { url: item.url, title: String(item.title || item.url).slice(0, 200) });
        }
      }
    }
    if (block.type === 'web_fetch_tool_result' && block.content?.url && !seen.has(block.content.url)) {
      const { url, content } = block.content;
      seen.set(url, { url, title: String(content?.title || url).slice(0, 200) });
    }
  }
  return [...seen.values()].slice(0, 12);
}

/**
 * Server tools do not throw.
 *
 * A failed search comes back as HTTP 200 with an error object where the results
 * list would be, so nothing upstream notices — the reply just quietly stops
 * being grounded in anything. Pull the code out so the turn can say so.
 */
function webToolErrorCode(blocks) {
  for (const block of blocks) {
    const content = WEB_RESULT_TYPES.has(block.type) ? block.content : null;
    if (content && !Array.isArray(content) && content.error_code) return String(content.error_code);
  }
  return null;
}

async function generateWithClaude({
  model, system, messages, maxTokens, cacheConversation = false, webTools = false, effort,
}) {
  const resolvedModel = model || await defaultClaudeModel();
  // Only worth a breakpoint when the prefix will be sent again. A one-shot
  // call would pay the 2x cache-write premium and never read it back.
  let convo = cacheConversation ? withConversationCache(messages) : messages;
  const blocks = [];
  const usage = {
    inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
  };
  let result = null;

  // A turn that uses a server tool can come back `pause_turn`, mid-sentence, with
  // the work so far. Resume it by replaying the partial assistant turn: the
  // cached prefix is untouched, so a resume is charged for the new blocks only.
  for (let round = 0; round < MAX_SERVER_TOOL_ROUNDS; round += 1) {
    result = await anthropicJson('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(buildClaudeRequest({
        model: resolvedModel, system, messages: convo, maxTokens, webTools, effort,
      })),
    });
    const content = result.content || [];
    blocks.push(...content);
    usage.inputTokens += result.usage?.input_tokens ?? 0;
    usage.outputTokens += result.usage?.output_tokens ?? 0;
    usage.cacheCreationInputTokens += result.usage?.cache_creation_input_tokens ?? 0;
    usage.cacheReadInputTokens += result.usage?.cache_read_input_tokens ?? 0;
    if (result.stop_reason !== 'pause_turn') break;
    convo = [...convo, { role: 'assistant', content }];
  }

  const draft = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  // Kept for display only, never replayed: a thinking block is bound to the
  // response that produced it, so the stored summary is text about the reply,
  // not a block that could be sent back as one.
  const thinking = blocks
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (!draft && result?.stop_reason === 'refusal') {
    throw Object.assign(new Error('Claude declined this request'), {
      status: 400,
      publicMessage: 'Claude declined to answer this request. Rephrase it and try again.',
    });
  }
  if (!draft) throw Object.assign(new Error('Claude returned an empty response'), { status: 502 });

  return {
    draft,
    thinking,
    sources: collectSources(blocks),
    searchErrorCode: webToolErrorCode(blocks),
    // The reply stopped at the token ceiling, so it is cut off mid-document.
    truncated: result?.stop_reason === 'max_tokens',
    source: 'claude',
    model: result.model || resolvedModel,
    usage,
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
 *
 * Web search, web fetch and adaptive thinking are all on, which is what makes a
 * studio answer match the one the same question gets in the Claude apps.
 *
 * The one-shot `draftCoverLetter` below gets no web tools: it runs in bulk off a
 * CV the server already holds, so a search per letter would add cost and latency
 * to every application without adding anything to write with. It does still
 * think — on Sonnet 5, the configured default, omitting `thinking` ran adaptive
 * thinking anyway, and the alternative (sending `disabled`) is documented to
 * leak `<thinking>` tags into the visible reply, which in a cover letter is
 * worse than the tokens it would save.
 */
export async function generateDocument({
  prompt, masterPrompt = '', attachments = [], history = [], model, effort,
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
      // The studio is the surface that is meant to feel like claude.ai, so it
      // gets the same live-web grounding and the same visible reasoning.
      webTools: true,
      effort,
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
