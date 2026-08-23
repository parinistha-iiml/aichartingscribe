import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

const buf = fs.readFileSync('/mnt/user-data/uploads/Discharge_Summary.pdf');
const loadingTask = getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true });
const doc = await loadingTask.promise;
console.log('numPages:', doc.numPages);
const page = await doc.getPage(1);
const content = await page.getTextContent();
console.log('items:', content.items.length);
console.log(JSON.stringify(content.items.slice(0, 5).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] })), null, 2));
