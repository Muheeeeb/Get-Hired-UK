import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

function cleanInline(text) {
  return String(text || '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .trim();
}

function classify(line) {
  const trimmed = line.trim();
  if (!trimmed) return { type: 'blank', text: '' };
  const bullet = trimmed.match(/^[-*•]\s+(.+)/);
  if (bullet) return { type: 'bullet', text: cleanInline(bullet[1]) };
  const explicitHeading = /^#{1,6}\s+/.test(trimmed);
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  const uppercaseHeading = trimmed.length <= 70 && letters.length >= 3 && letters === letters.toUpperCase();
  if (explicitHeading || uppercaseHeading) return { type: 'heading', text: cleanInline(trimmed) };
  return { type: 'paragraph', text: cleanInline(trimmed) };
}

export function documentBlocks(content) {
  return String(content || '').replace(/\r\n?/g, '\n').split('\n').map(classify);
}

export async function buildPdf(content, title = 'AI Draft') {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, right: 54, bottom: 54, left: 54 },
    info: { Title: title, Author: 'Get Hired Global' },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  doc.fillColor('#0b2347');
  for (const block of documentBlocks(content)) {
    if (block.type === 'blank') {
      doc.moveDown(0.45);
    } else if (block.type === 'heading') {
      doc.moveDown(0.35).font('Helvetica-Bold').fontSize(13).fillColor('#0b2347').text(block.text, {
        paragraphGap: 4,
      });
    } else if (block.type === 'bullet') {
      doc.font('Helvetica').fontSize(10.5).fillColor('#202735').text(`•  ${block.text}`, {
        indent: 10,
        paragraphGap: 3,
        lineGap: 1.5,
      });
    } else {
      doc.font('Helvetica').fontSize(10.5).fillColor('#202735').text(block.text, {
        paragraphGap: 4,
        lineGap: 1.5,
      });
    }
  }
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

export async function buildDocx(content, title = 'AI Draft') {
  const children = documentBlocks(content).map((block) => {
    if (block.type === 'blank') return new Paragraph({ spacing: { after: 100 } });
    if (block.type === 'heading') {
      return new Paragraph({
        text: block.text,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 180, after: 80 },
      });
    }
    if (block.type === 'bullet') {
      return new Paragraph({
        children: [new TextRun({ text: block.text, size: 21 })],
        bullet: { level: 0 },
        spacing: { after: 70, line: 276 },
      });
    }
    return new Paragraph({
      children: [new TextRun({ text: block.text, size: 21 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 90, line: 276 },
    });
  });

  const document = new Document({
    creator: 'Get Hired Global',
    title,
    description: 'AI Studio document export',
    styles: {
      default: {
        document: { run: { font: 'Aptos', size: 21 }, paragraph: { spacing: { line: 276 } } },
        heading2: { run: { font: 'Aptos Display', size: 26, bold: true, color: '0B2347' } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 780, bottom: 720, left: 780 } },
      },
      children,
    }],
  });
  return Packer.toBuffer(document);
}
