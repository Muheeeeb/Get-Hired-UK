import { env } from '../config/env.js';

/**
 * Server-side only cover-letter drafting. The OpenAI key never leaves this process.
 * When no key is configured and MOCK_AI=true, produces a structured local draft
 * so the feature is demoable offline.
 */
export async function draftCoverLetter({ clientName, jobTitle, company, domainName, masterCvText }) {
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
          content:
            'You are an expert UK recruitment copywriter. Write a concise, professional cover letter (250-350 words, UK English). No placeholders like [Name] — use the details provided. Return only the letter body.',
        },
        {
          role: 'user',
          content: [
            `Candidate: ${clientName}`,
            `Applying for: ${jobTitle} at ${company}`,
            domainName ? `Career domain: ${domainName}` : '',
            masterCvText ? `Master CV content:\n${masterCvText.slice(0, 6000)}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });
    return { draft: completion.choices[0].message.content.trim(), source: 'openai' };
  }

  if (!env.mockAi) {
    const err = new Error('AI assistant is not configured (set AI_API_KEY in server/.env)');
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
