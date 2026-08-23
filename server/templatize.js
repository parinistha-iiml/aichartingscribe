// Turns an uploaded, real hospital document (PDF with a text layer, or a
// scanned image) into a reusable discharge-template with {{placeholders}}
// in place of THIS patient's specific values — so the template can be
// reused for every future patient, and nothing about the source patient
// is retained.

// pdf-parse bundles pdfjs-dist, which expects browser globals (DOMMatrix,
// ImageData, Path2D) for canvas-based rendering. We only ever extract text
// (never render a page to an image), but pdfjs still references these at
// module load time — without them it throws `ReferenceError: DOMMatrix is
// not defined` and crashes the whole process. Rather than pull in a native
// canvas binary (@napi-rs/canvas) — which is a common source of bundling
// failures on serverless platforms like Vercel, since its platform-specific
// binary is resolved dynamically and can be missed by static file-tracing —
// we polyfill just enough with pure JS. `dommatrix` is a real, dependency-free
// shim; ImageData/Path2D only need to exist, not actually render anything.
if (typeof global.DOMMatrix === 'undefined') {
  global.DOMMatrix = require('dommatrix');
}
if (typeof global.ImageData === 'undefined') {
  global.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}
if (typeof global.Path2D === 'undefined') {
  global.Path2D = class Path2D {
    constructor() {}
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
    arc() {}
    bezierCurveTo() {}
  };
}

const { PDFParse } = require('pdf-parse');

function slug(label) {
  return label
    .toLowerCase()
    .replace(/[().,/&]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Safety-net patterns for stray identifiers (record/file IDs, phone
// numbers) — applied to every line of output regardless of how it was
// classified.
const STRAY_ID_PATTERNS = [
  { re: /\b[A-Z]{2,10}\.\d{6,}\b/g, placeholder: '{{document_id}}' },
  { re: /\b[6-9]\d{9}\b/g, placeholder: '{{mobile_no}}' },
  { re: /\b[A-Z]{2,6}\d{8,}\b/g, placeholder: '{{record_no}}' },
];

function applyStraySafetyNet(text) {
  let out = text;
  for (const { re, placeholder } of STRAY_ID_PATTERNS) out = out.replace(re, placeholder);
  return out;
}

// ---- Layout-aware extraction (PDFs with a text layer) ----
//
// Pulls the raw positioned text items (x, y, font size, font) straight from
// the PDF — the same data pdfjs uses to render the page — instead of the
// flattened, order-only string a plain "extract text" call returns. Two
// signals come out of that layout data and drive everything below:
//
//  - FONT SIZE tells section headings ("General Information", "Patient's
//    History") apart from body text — headings render measurably larger.
//  - FONT IDENTITY tells a field's bold LABEL apart from its plain VALUE at
//    the same size — hospital forms almost always style labels differently
//    from the values next to them, even when there's no gap between two
//    columns worth of "Label : value" pairs on the same line.
//
// Both signals are discovered per-document (which font is "the label font"
// is learned from the PDF itself, not assumed), so this isn't tied to any
// one hospital's field names or a fixed vocabulary — it generalizes to a
// document whose layout we've never seen before.

async function extractLayoutFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    await parser.getText(); // triggers internal document load
    const numPages = parser.doc.numPages;
    const rows = [];
    for (let p = 1; p <= numPages; p++) {
      const page = await parser.doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it) => it.str && it.str.trim().length > 0)
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          w: it.width,
          fontSize: Math.hypot(it.transform[0], it.transform[1]),
          fontName: it.fontName,
        }));

      // Group items into visual rows by y-position (small tolerance for
      // sub-pixel baseline jitter within the same printed line).
      const rowMap = new Map();
      for (const it of items) {
        const key = Math.round(it.y / 2.5);
        if (!rowMap.has(key)) rowMap.set(key, []);
        rowMap.get(key).push(it);
      }
      const ys = [...rowMap.keys()].sort((a, b) => b - a); // top of page first
      for (const y of ys) rows.push(rowMap.get(y).sort((a, b) => a.x - b.x));
    }
    return rows; // array of rows; each row is an array of positioned items
  } finally {
    await parser.destroy();
  }
}

// Learns the document's body font size and its "label font" (the font most
// often used on text immediately followed by a ':') from its own layout,
// rather than assuming any fixed convention.
function analyzeLayout(rows) {
  const allItems = rows.flat();

  const sizeFreq = new Map();
  for (const it of allItems) {
    const key = Math.round(it.fontSize * 10) / 10;
    sizeFreq.set(key, (sizeFreq.get(key) || 0) + 1);
  }
  let bodyFontSize = 11;
  let bestSizeCount = 0;
  for (const [size, count] of sizeFreq) {
    if (count > bestSizeCount) {
      bestSizeCount = count;
      bodyFontSize = size;
    }
  }

  const labelFontFreq = new Map();
  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      const cur = row[i];
      const next = row[i + 1];
      if (next.str.trim() === ':' && Math.abs(cur.fontSize - bodyFontSize) < 0.6) {
        labelFontFreq.set(cur.fontName, (labelFontFreq.get(cur.fontName) || 0) + 1);
      }
    }
  }
  let labelFontName = null;
  let labelBest = 0;
  for (const [font, count] of labelFontFreq) {
    if (count > labelBest) {
      labelBest = count;
      labelFontName = font;
    }
  }

  return { bodyFontSize, labelFontName };
}

function reconstructRowText(row) {
  let text = '';
  let prevEnd = null;
  for (const it of row) {
    if (prevEnd !== null && it.x - prevEnd > 1.5) text += ' ';
    text += it.str;
    prevEnd = it.x + it.w;
  }
  return text.trim();
}

// Within one row, finds every run of "label font" items that's immediately
// followed by a ':' — each one is a distinct field on that row, however
// many columns are packed onto it.
function splitRowIntoFields(row, labelFontName) {
  if (!labelFontName) return [];
  const segments = [];
  let i = 0;
  while (i < row.length) {
    if (row[i].fontName === labelFontName && row[i].str.trim() !== ':') {
      const labelParts = [];
      let j = i;
      while (j < row.length && row[j].fontName === labelFontName && row[j].str.trim() !== ':') {
        labelParts.push(row[j].str);
        j++;
      }
      if (j < row.length && row[j].str.trim() === ':') {
        const label = labelParts.join(' ').trim().replace(/\s+/g, ' ');
        if (label && label.length <= 60) segments.push({ label });
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return segments;
}

const HEADING_SIZE_RATIO = 1.15;

// Builds the template by walking the document's rows in order. Every row is
// exactly one of three things: a section heading (kept literally — it's
// structure, not patient data), one or more labeled fields (each becomes
// "Label : {{placeholder}}", using the label text this document itself
// uses), or unlabeled narrative/continuation text, which is dropped
// entirely rather than guessed at — safer to omit a value than risk
// echoing part of it.
function templatizeFromLayout(rows) {
  const { bodyFontSize, labelFontName } = analyzeLayout(rows);
  const outputLines = [];
  const detectedFields = [];
  let sawAnyLabeledField = false;

  for (const row of rows) {
    if (row.length === 0) continue;
    const maxFontSize = Math.max(...row.map((it) => it.fontSize));

    if (maxFontSize > bodyFontSize * HEADING_SIZE_RATIO) {
      outputLines.push(applyStraySafetyNet(reconstructRowText(row)));
      continue;
    }

    const segments = splitRowIntoFields(row, labelFontName);
    if (segments.length > 0) {
      sawAnyLabeledField = true;
      for (const { label } of segments) {
        outputLines.push(`${label} : {{${slug(label)}}}`);
        detectedFields.push(label);
      }
    }
    // Unlabeled body-size rows (narrative/continuation) are dropped — the
    // field they belong to already got its placeholder line above.
  }

  return {
    templateText: outputLines.join('\n'),
    detectedFields,
    usableLayout: !!labelFontName && sawAnyLabeledField,
  };
}

// ---- Flat-text fallback (used when a PDF has no detectable label font,
// and for mocked image OCR, which has no layout data at all) ----

// Generic hospital discharge-summary field labels — used only as a
// fallback vocabulary when the document's own layout doesn't give us a
// label font to key off. Structure only, not any patient's data.
const KNOWN_HEADERS = [
  'Admitting Doctor/Consultant',
  'Admitting Doctor',
  'Treating Doctor',
  'Head of the Dept',
  'Unit Head',
  'Unit',
  'D.O.A',
  'D.O.D',
  'Name of Patient',
  'IP No',
  'Age/Sex',
  'Mobile No',
  'Address',
  'Clinical Profile',
  'Final Diagnosis',
  'Provisional Diagnosis',
  'SARS-COV-2',
  'SURGERY/(if any)/Course in the hospital',
  'Course in the hospital',
  'SURGERY',
  'Type of Discharge',
  'Diet',
  'Follow up',
  'Physical activity',
  'Medication',
  'Miscellaneous(If any)',
  'Miscellaneous',
  'Investigations',
  'Radiology Notes',
  'Radiology Service',
  'Prepared By (Name & designation)',
  'Prepared By',
].sort((a, b) => b.length - a.length);

function templatizeFlatText(rawText) {
  const text = rawText.replace(/\r\n/g, '\n');
  const matches = [];
  for (const header of KNOWN_HEADERS) {
    const escaped = escapeRegex(header);
    const lineStart = new RegExp(`(^|\\n)[ \\t]*${escaped}[ \\t]*:?[ \\t]*`, 'gi');
    const midLine = new RegExp(`${escaped}[ \\t]*:[ \\t]*`, 'gi');
    for (const re of [lineStart, midLine]) {
      let m;
      while ((m = re.exec(text)) !== null) matches.push({ header, start: m.index, valueStart: m.index + m[0].length });
    }
  }
  matches.sort((a, b) => a.start - b.start);

  const clean = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start < lastEnd) continue;
    clean.push(m);
    lastEnd = m.valueStart;
  }

  if (clean.length === 0) {
    return { templateText: applyStraySafetyNet(text), detectedFields: [] };
  }

  let out = text.slice(0, clean[0].start);
  const detectedFields = [];
  clean.forEach((m) => {
    out += `\n${m.header} : {{${slug(m.header)}}}\n`;
    detectedFields.push(m.header);
  });

  return { templateText: applyStraySafetyNet(out.trim()), detectedFields };
}

async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function templatizePdf(buffer) {
  const rows = await extractLayoutFromPdf(buffer);
  const layout = templatizeFromLayout(rows);

  if (layout.usableLayout) {
    return {
      templateText: layout.templateText,
      detectedFields: layout.detectedFields,
      warnings: [
        "Auto-generated using the document's own layout (heading size + label styling) — review every line before saving. Confirm no patient name, ID, phone number, or address remains anywhere in the text below.",
      ],
    };
  }

  // Layout didn't give us a clear label font (e.g. a plainer form with no
  // bold/plain distinction) — fall back to the keyword-based matcher.
  const rawText = await extractTextFromPdf(buffer);
  const flat = templatizeFlatText(rawText);
  return {
    templateText: flat.templateText,
    detectedFields: flat.detectedFields,
    warnings: [
      "Could not detect a distinct label style in this document's layout, so this fell back to matching common field names instead. It may miss labels this hospital phrases differently — review every line before saving.",
    ],
  };
}

module.exports = { templatizePdf, templatizeFlatText, extractTextFromPdf };