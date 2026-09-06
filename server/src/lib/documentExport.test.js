import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocx, buildPdf } from './documentExport.js';
import { extractDocumentText, extractReferenceFiles } from './documentText.js';

const sample = `JANE EXAMPLE

PROFESSIONAL PROFILE
Senior operations leader with ten years of experience improving customer outcomes.

KEY ACHIEVEMENTS
• Increased successful placements by 35%.
• Led a team of twelve specialists.`;

test('formatted PDF export is readable when uploaded back into AI Studio', async () => {
  const pdf = await buildPdf(sample, 'Jane Example CV');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

  const extracted = await extractDocumentText(pdf, 'jane-example.pdf');
  assert.match(extracted.text, /JANE EXAMPLE/);
  assert.match(extracted.text, /successful placements by 35%/);
});

test('formatted Word export is readable when uploaded back into AI Studio', async () => {
  const docx = await buildDocx(sample, 'Jane Example CV');
  assert.equal(docx.subarray(0, 2).toString(), 'PK');

  const extracted = await extractDocumentText(docx, 'jane-example.docx');
  assert.match(extracted.text, /JANE EXAMPLE/);
  assert.match(extracted.text, /team of twelve specialists/);
});

test('long PDF exports flow across pages without losing the end of the CV', async () => {
  const longCv = `JANE EXAMPLE\n\nEXPERIENCE\n${Array.from(
    { length: 180 },
    (_, index) => `• Achievement ${index + 1}: delivered a measurable improvement across the organisation.`,
  ).join('\n')}\n\nEND OF CV`;
  const pdf = await buildPdf(longCv, 'Long CV');
  const extracted = await extractDocumentText(pdf, 'long-cv.pdf');

  assert.match(extracted.text, /Achievement 180/);
  assert.match(extracted.text, /END OF CV/);
});

test('multiple reference files are labelled and retained beyond 6,000 characters', async () => {
  const longCv = `Candidate CV\n${'Relevant experience and measurable achievement. '.repeat(300)}`;
  const result = await extractReferenceFiles([
    { originalname: 'candidate.txt', buffer: Buffer.from(longCv) },
    { originalname: 'brief.md', buffer: Buffer.from('Target role: Operations Director') },
  ]);

  assert.ok(result.referenceText.length > 6_000);
  assert.match(result.referenceText, /--- candidate\.txt ---/);
  assert.match(result.referenceText, /--- brief\.md ---/);
  assert.deepEqual(result.usedFiles, ['candidate.txt', 'brief.md']);
});

test('unsupported uploads fail with a clear client-safe message', async () => {
  await assert.rejects(
    extractDocumentText(Buffer.from('data'), 'candidate.png'),
    (err) => err.status === 400 && /unsupported file type/i.test(err.publicMessage),
  );
});
