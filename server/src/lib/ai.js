import { env } from '../config/env.js';

const ANTHROPIC_VERSION = '2023-06-01';
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
    err.status = response.status === 429 ? 429 : 502;
    throw err;
  }
  return data;
}

/** Models currently available to this Anthropic API key (cached for five minutes). */
export async function listClaudeModels() {
  if (!env.anthropicApiKey) {
    const fallback = env.anthropicModel || 'claude-sonnet-4-5';
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

export async function defaultClaudeModel() {
  if (env.anthropicModel) return env.anthropicModel;
  const models = await listClaudeModels();
  return models[0]?.id || 'claude-sonnet-4-5';
}

async function generateWithClaude({ model, system, messages, maxTokens }) {
  const result = await anthropicJson('/v1/messages', {
    method: 'POST',
    body: JSON.stringify({ model: model || await defaultClaudeModel(), system, messages, max_tokens: maxTokens, temperature: 0.7 }),
  });
  const draft = (result.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!draft) throw Object.assign(new Error('Claude returned an empty response'), { status: 502 });
  return { draft, source: 'claude', model: result.model || model };
}

/**
 * Server-side only drafting. Provider keys never leave this process.
 * When no key is configured and MOCK_AI=true, produces a structured local draft
 * so the feature is demoable offline.
 */
/**
 * General document generator for the employee AI Studio.
 * kind: 'cv' | 'cover_letter' | 'freeform'
 */
export async function generateDocument({
  kind, prompt, clientName, domainName, masterText, referenceText, history = [], model,
}) {
  const base =
    kind === 'cv'
      ? 'You are an expert UK CV writer. Produce a complete, well-structured CV in plain text (UK English): profile, key achievements, experience, education, skills. Quantify achievements. No placeholders — use the provided material.'
      : kind === 'cover_letter'
        ? 'You are an expert UK recruitment copywriter. Write a concise, professional cover letter (250-350 words, UK English). Return only the letter body.'
        : 'You are an expert UK careers assistant helping a recruitment specialist draft documents. Follow the instructions precisely. UK English.';
  // The studio is a conversation: the specialist iterates on the draft, so also
  // answer questions and explain choices rather than only emitting documents.
  const system = `${base}\n\nYou are in an ongoing chat with a recruitment specialist. Keep the full conversation in mind and apply their revisions to the previous draft. When they ask a question rather than request a document, answer it directly and concisely.`;

  const isFollowUp = history.length > 0;
  // Context (candidate, master CV) is established on the first turn — later turns
  // only carry the new instruction, so follow-ups stay fast and cheap.
  const userContent = (isFollowUp
    ? [prompt, referenceText ? `Reference material:\n${referenceText.slice(0, 6000)}` : '']
    : [
        clientName ? `Candidate: ${clientName}` : '',
        domainName ? `Career domain: ${domainName}` : '',
        prompt ? `Instructions:\n${prompt}` : '',
        masterText ? `Master document content:\n${masterText.slice(0, 6000)}` : '',
        referenceText ? `Reference material:\n${referenceText.slice(0, 6000)}` : '',
      ]
  ).filter(Boolean).join('\n\n');

  if (env.anthropicApiKey) {
    return generateWithClaude({
      model,
      system,
      maxTokens: 1500,
      messages: [
        ...history.map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: userContent },
      ],
    });
  }

  if (env.aiApiKey) {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: env.aiApiKey, baseURL: env.aiBaseUrl });
    const completion = await openai.chat.completions.create({
      model: env.aiModel,
      temperature: 0.7,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent },
      ],
    });
    return { draft: completion.choices[0].message.content.trim(), source: 'ai' };
  }

  if (!env.mockAi) {
    const err = new Error('AI assistant is not configured (set ANTHROPIC_API_KEY in server/.env)');
    err.status = 503;
    throw err;
  }
  return {
    draft: `— AI draft (offline mode) —\n\n${userContent}\n\n(Configure ANTHROPIC_API_KEY for real generations.)`,
    source: 'mock',
  };
}

export async function draftCoverLetter({ clientName, jobTitle, company, domainName, masterCvText, model }) {
  const system = 'You are an expert UK recruitment copywriter. Write a concise, professional cover letter (250-350 words, UK English). No placeholders like [Name] — use the details provided. Return only the letter body.';
  const userContent = [
    `Candidate: ${clientName}`,
    `Applying for: ${jobTitle} at ${company}`,
    domainName ? `Career domain: ${domainName}` : '',
    masterCvText ? `Master CV content:\n${masterCvText.slice(0, 6000)}` : '',
  ].filter(Boolean).join('\n\n');

  if (env.anthropicApiKey) {
    return generateWithClaude({
      model, system, maxTokens: 700, messages: [{ role: 'user', content: userContent }],
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
      messages: [
        {
          role: 'system',
          content: system,
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
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
