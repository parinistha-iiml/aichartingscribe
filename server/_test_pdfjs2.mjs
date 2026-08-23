import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const buf = fs.readFileSync('/mnt/user-data/uploads/Discharge_Summary.pdf');
const loadingTask = getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true });
const doc = await loadingTask.promise;
const page = await doc.getPage(1);
const content = await page.getTextContent();

// Group by row (y, rounded)
const rows = {};
for (const item of content.items) {
  if (!item.str.trim()) continue;
  const y = Math.round(item.transform[5]);
  rows[y] = rows[y] || [];
  rows[y].push({ str: item.str, x: Math.round(item.transform[4]) });
}
const sortedYs = Object.keys(rows).map(Number).sort((a,b) => b-a);
for (const y of sortedYs.slice(0, 20)) {
  const items = rows[y].sort((a,b) => a.x - b.x);
  console.log(y, '|', items.map(i => `[${i.x}]${i.str}`).join(' '));
}
