// Reads a discharge template's own {{placeholders}} — and the label text
// sitting next to each one — so the review step can show the doctor
// exactly the hospital's own fields ("Name of Patient", "IP No", "Final
// Diagnosis"...) instead of a fixed generic shape that then has to be
// reverse-mapped later. This is what makes the review step template-driven
// rather than template-agnostic.

function humanize(slug) {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// templatize.js always emits "Label : {{slug}}" on its own line, so that's
// the primary pattern. Falls back to a de-slugified label for anything
// that doesn't follow that convention (e.g. a hand-typed template, or a
// placeholder used inline mid-sentence).
function extractTemplateFields(templateText) {
  const fields = [];
  const seen = new Set();

  const lineRe = /^(.*?):\s*\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s*$/gm;
  let m;
  while ((m = lineRe.exec(templateText)) !== null) {
    const label = m[1].trim();
    const slug = m[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    fields.push({ slug, label: label || humanize(slug) });
  }

  const anyRe = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  while ((m = anyRe.exec(templateText)) !== null) {
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    fields.push({ slug, label: humanize(slug) });
  }

  return fields;
}

module.exports = { extractTemplateFields, humanize };
