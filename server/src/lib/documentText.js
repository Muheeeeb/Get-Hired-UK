import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import WordExtractor from 'word-extractor';

export const SUPPORTED_DOCUMENT_EXTENSIONS = ['.txt', '.md', '.pdf', '.doc', '.docx'];
export const MAX_EXTRACTED_FILE_CHARS = 100_000;
export const MAX_REFERENCE_CHARS = 180_000;

function documentError(filename, message) {
  const err = new Error(message);
  err.status = 400;
  err.publicMessage = `${filename}: ${message}`;
  return err;
}

function normaliseText(value) {
  return String(value || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** Extract readable text from an uploaded CV without writing it to disk. */
export async function extractDocumentText(buffer, filename, maxChars = MAX_EXTRACTED_FILE_CHARS) {
  const safeName = path.basename(filename || 'document');
  const ext = path.extname(safeName).toLowerCase();
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.includes(ext)) {
    throw documentError(safeName, 'unsupported file type. Use PDF, Word (.doc/.docx), TXT, or Markdown.');
  }

  let text = '';
  try {
    if (ext === '.txt' || ext === '.md') {
      text = buffer.toString('utf8');
    } else if (ext === '.pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText({ first: 50 });
        text = result.text;
      } finally {
        await parser.destroy();
      }
    } else {
      const document = await new WordExtractor().extract(buffer);
      text = [document.getBody(), document.getHeaders(), document.getFootnotes(), document.getEndnotes()]
        .filter(Boolean)
        .join('\n');
    }
  } catch (cause) {
    const err = documentError(safeName, 'could not be read. Confirm the file is not password-protected or damaged.');
    err.cause = cause;
    throw err;
  }

  text = normaliseText(text);
  if (!text) {
    throw documentError(safeName, 'contains no readable text. If this is a scanned PDF, run OCR first.');
  }
  return { text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

/** Extract multiple references with one bounded context budget. */
export async function extractReferenceFiles(files, maxChars = MAX_REFERENCE_CHARS) {
  const sections = [];
  const usedFiles = [];
  const truncatedFiles = [];
  let remaining = maxChars;

  for (const file of files) {
    if (remaining <= 0) {
      truncatedFiles.push(file.originalname);
      continue;
    }
    const result = await extractDocumentText(file.buffer, file.originalname, remaining);
    sections.push(`--- ${path.basename(file.originalname)} ---\n${result.text}`);
    usedFiles.push(file.originalname);
    remaining -= result.text.length;
    if (result.truncated) truncatedFiles.push(file.originalname);
  }

  return {
    referenceText: sections.join('\n\n') || null,
    usedFiles,
    truncatedFiles,
  };
}
