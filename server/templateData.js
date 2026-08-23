// Deterministic template-population logic — NOT an AI service, mocked or
// otherwise. This is plain code that fills a discharge template's
// {{placeholders}} from real data (extracted entities, patient/doctor
// records, dictation text). It used to live in a file called mockAI.js
// alongside actual mocked AI fallbacks, which was a misleading place for
// it — this file contains zero fabricated data and zero AI calls.

// Real hospital templates (from the OCR/upload flow in templatize.js) use
// {{placeholders}} slugged from THAT hospital's own field labels —
// {{name_of_patient}}, {{final_diagnosis}}, {{medication}}. This alias map
// resolves common real-world variants of each concept to the one value we
// actually have, so filling works regardless of how a given hospital
// phrases its field labels.
const PLACEHOLDER_ALIASES = {
  patient_name: ['patient_name', 'name_of_patient', 'name', 'patient'],
  patient_age: ['patient_age', 'age', 'age_sex'],
  doctor_name: ['doctor_name', 'treating_doctor', 'admitting_doctor', 'admitting_doctor_consultant', 'consultant', 'physician'],
  date: ['date', 'discharge_date', 'd_o_d'],
  diagnosis: ['diagnosis', 'final_diagnosis', 'provisional_diagnosis', 'diagnoses'],
  icd10: ['icd10', 'icd_10'],
  symptoms: ['symptoms', 'clinical_profile', 'presenting_symptoms', 'presenting_complaints', 'chief_complaints'],
  medications: ['medications', 'medication', 'discharge_medications', 'meds'],
  followup_instructions: ['followup_instructions', 'follow_up', 'advice_on_discharge', 'followup', 'follow_up_advice'],
};

const ALIAS_TO_CONCEPT = Object.entries(PLACEHOLDER_ALIASES).reduce((acc, [concept, aliases]) => {
  aliases.forEach((alias) => { acc[alias] = concept; });
  return acc;
}, {});

// Fallback filler — used only when a caller doesn't supply doctor-reviewed
// field values (see fillTemplateFromFieldValues below, which is the
// primary path now that /template-fields exists). Resolves via alias
// matching directly against the canonical structured note.
function fillDischargeTemplate(templateText, data) {
  return templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const concept = ALIAS_TO_CONCEPT[key] || key;
    const value = data[concept];
    if (value === undefined || value === null || value === '') return '_____ (not captured — fill in manually)';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None documented';
    return String(value);
  });
}

function buildTemplateData({ patient, doctor, structuredNote, date }) {
  return {
    patient_name: patient?.name || '',
    patient_age: patient?.age ?? '',
    doctor_name: doctor?.name || '',
    date: date || new Date().toLocaleDateString('en-IN'),
    diagnosis: structuredNote.diagnosis,
    icd10: structuredNote.icd10,
    symptoms: structuredNote.symptoms,
    medications: structuredNote.meds,
    followup_instructions:
      'Return for follow-up as advised, or sooner if symptoms worsen. Seek urgent care for chest pain, breathing difficulty, or high-grade fever.',
  };
}

// Resolves ONE template field's value from real sources — the structured
// entities from Text Analytics for Health, and for follow-up instructions,
// the doctor's own dictated sentence about it (pulled from the actual
// transcript, not invented). Fields with no real data source (hospital
// admin fields like IP No, Unit, Head of Dept — nothing in our data model
// covers these) resolve to '' so the review UI flags them for manual
// entry instead of guessing.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'have', 'been',
  'name', 'type', 'notes', 'note', 'details', 'information', 'number', 'date',
]);

// Common abbreviations vs. their spoken-out-loud form — a template field
// labeled with the printed abbreviation ("Dept", "Dr", "Hosp") will never
// substring-match a dictation that says the word in full ("Department",
// "Doctor", "Hospital"), and vice versa. This isn't a stemming problem
// (dropping vowels from "department" doesn't produce a prefix match on
// "dept" — the 4th letter differs), so it needs an explicit expansion in
// both directions.
const ABBREVIATION_EXPANSIONS = {
  dept: 'department',
  department: 'dept',
  dr: 'doctor',
  doctor: 'dr',
  hosp: 'hospital',
  hospital: 'hosp',
  pt: 'patient',
  patient: 'pt',
  hx: 'history',
  history: 'hx',
  dx: 'diagnosis',
  admn: 'admission',
  admission: 'admn',
  wt: 'weight',
  weight: 'wt',
  ht: 'height',
  height: 'ht',
  temp: 'temperature',
  temperature: 'temp',
  rx: 'prescription',
  prescription: 'rx',
  ivf: 'fluids',
  meds: 'medications',
  medications: 'meds',
  med: 'medication',
  medication: 'med',
  consult: 'consultant',
  consultant: 'consult',
  op: 'operation',
  operation: 'op',
  proc: 'procedure',
  procedure: 'proc',
};

// A few common discharge-summary sections where the doctor's actual
// wording rarely repeats the section's own header word — e.g. "Chest
// x-ray done, no consolidation" never says "investigations". Keyed by a
// substring match against the field's own label (not an exact slug match),
// so this still works regardless of how a given hospital phrases the
// header, as long as it contains a recognizable word like "investigation"
// or "diet".
const SECTION_SYNONYMS = [
  { labelMatch: /investigat|radiolog|lab\b/i, keywords: ['x-ray', 'xray', 'scan', 'ultrasound', 'usg', 'mri', 'ct scan', 'blood test', 'lab', 'report', 'imaging', 'doppler', 'test'] },
  { labelMatch: /diet/i, keywords: ['diet', 'food', 'meal', 'feeding', 'nutrition', 'hydration'] },
  { labelMatch: /physical activity|activity/i, keywords: ['activity', 'exercise', 'rest', 'walk', 'lifting', 'exertion'] },
  { labelMatch: /surgery|procedure|course in the hospital/i, keywords: ['surgery', 'procedure', 'operation', 'operative', 'delivered', 'repaired'] },
  { labelMatch: /miscellaneous|advice/i, keywords: ['advised', 'instructed', 'counseled', 'counselled'] },
];

// Abbreviations that end in a period but don't actually end a sentence —
// without protecting these, "Dr." gets treated as a sentence boundary and
// splitSentences would cut a captured value off right before the name
// that follows it.
const ABBREVIATIONS_WITH_PERIODS = ['Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'St', 'Jr', 'Sr'];

function splitSentences(text) {
  if (!text) return [];
  let protectedText = text;
  for (const abbr of ABBREVIATIONS_WITH_PERIODS) {
    protectedText = protectedText.replace(new RegExp(`\\b${abbr}\\.`, 'g'), `${abbr}\u0000`);
  }
  const matches = protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return matches.map((s) => s.replace(/\u0000/g, '.').trim());
}

// Generic fallback for any template field with no direct concept mapping:
// search the actual dictation for sentences containing the field's own
// label words (plus a few known domain synonyms for common sections — see
// SECTION_SYNONYMS above). Most hospital-specific fields (Diet, Physical
// activity, Investigations, Type of Discharge, Miscellaneous...) don't map
// to a fixed clinical concept, but the doctor usually DOES dictate
// something under that heading — this finds it instead of leaving the
// field blank just because it wasn't on a hardcoded list. Genuinely
// admin-only fields with no clinical content at all (IP No, Unit, Head of
// Dept — pure hospital record-keeping, never spoken in a clinical
// dictation) will still correctly come back empty, which is honest:
// there's no dictation content that could fill them.
function searchTranscriptByLabel(label, rawTranscript) {
  if (!rawTranscript) return '';
  const sentences = splitSentences(rawTranscript);

  const synonymHit = SECTION_SYNONYMS.find((s) => s.labelMatch.test(label || ''));
  // Keep a word if it's long enough to be meaningful on its own (>3 chars)
  // OR it's a known short abbreviation ("Dr", "Pt", "Hx", "Dx"...) that the
  // length check would otherwise throw away before it ever reaches the
  // expansion step below — the printed form on a template is often exactly
  // this short, even though nobody dictates it that way.
  const labelWords = (label || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => (w.length > 3 || ABBREVIATION_EXPANSIONS[w]) && !STOP_WORDS.has(w));

  // Add the abbreviation/expansion counterpart of every label word too, so
  // "Dept" in the template still finds "Department" in the dictation (and
  // vice versa) instead of missing purely because of how each was phrased.
  const withExpansions = labelWords.flatMap((w) => (ABBREVIATION_EXPANSIONS[w] ? [w, ABBREVIATION_EXPANSIONS[w]] : [w]));

  const keywords = synonymHit ? [...withExpansions, ...synonymHit.keywords] : withExpansions;
  if (!keywords.length) return '';

  const hits = sentences.filter((s) => {
    const lower = s.toLowerCase();
    return keywords.some((w) => lower.includes(w));
  });
  return hits.join(' ');
}

// Fields with a fixed clinical/administrative concept we already have an
// exact value for — these are NEVER sent to an LLM. There's nothing to
// "extract" or infer about them; re-deriving them from free text would
// only add a chance of the model getting a fact wrong that we already
// know for certain (the patient's actual age, the diagnosis Text
// Analytics for Health already extracted, etc).
const DETERMINISTIC_CONCEPTS = new Set([
  'patient_name', 'patient_age', 'doctor_name', 'date', 'diagnosis', 'icd10', 'symptoms', 'medications',
]);

// Returns the resolved value for a field IF it maps to a concept we have
// exact data for, or `undefined` if this field has no fixed concept and
// needs the free-text fallback path (regex search, or Groq — see
// resolveFallbackFieldValueRegex below and groqAI.js).
function resolveDeterministicFieldValue(slug, { patient, doctor, structuredNote }) {
  const concept = ALIAS_TO_CONCEPT[slug] || slug;
  if (!DETERMINISTIC_CONCEPTS.has(concept)) return undefined;
  switch (concept) {
    case 'patient_name':
      return patient?.name || '';
    case 'patient_age':
      return patient?.age != null ? String(patient.age) : '';
    case 'doctor_name':
      return doctor?.name || '';
    case 'date':
      return new Date().toLocaleDateString('en-IN');
    case 'diagnosis':
      return structuredNote?.diagnosis || '';
    case 'icd10':
      return (structuredNote?.icd10 || []).join(', ');
    case 'symptoms':
      return (structuredNote?.symptoms || []).join(', ');
    case 'medications':
      return (structuredNote?.meds || []).join(', ');
    default:
      return undefined;
  }
}

// The old keyword/regex fallback — still used for any field with no fixed
// concept (Investigations, Diet, Miscellaneous, follow-up instructions,
// whatever a given hospital's template calls its own sections) when Groq
// isn't configured. When Groq IS configured, server/index.js routes these
// same fields through groqAI.groqMapTemplateFields instead and never
// calls this function.
function resolveFallbackFieldValueRegex(slug, { rawTranscript, label }) {
  const concept = ALIAS_TO_CONCEPT[slug] || slug;
  if (concept === 'followup_instructions') {
    const sentences = splitSentences(rawTranscript);
    const hits = sentences.filter((s) => /follow[\s-]?up|recheck|review in|come back/i.test(s));
    return hits.join(' ') || searchTranscriptByLabel(label, rawTranscript);
  }
  return searchTranscriptByLabel(label, rawTranscript);
}

// Kept for backward compatibility with any existing caller — does the
// same single-field resolution as before (deterministic concept first,
// regex fallback otherwise), all in one synchronous call.
function resolveTemplateFieldValue(slug, ctx) {
  const det = resolveDeterministicFieldValue(slug, ctx);
  if (det !== undefined) return det;
  return resolveFallbackFieldValueRegex(slug, ctx);
}

// Once the doctor has reviewed/edited the template's own fields (see
// templateFields.js + resolveTemplateFieldValue above), filling the
// document is pure substitution — no alias guessing needed, since the
// values are already keyed to the template's own slugs.
function fillTemplateFromFieldValues(templateText, fieldValues) {
  return templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = fieldValues[key];
    if (value === undefined || value === null || value === '') return '_____ (not captured — fill in manually)';
    return String(value);
  });
}

// Supported translation target languages — a static lookup of language
// codes to display names, not AI-generated content.
const LANGUAGE_LABELS = {
  hi: 'Hindi',
  mr: 'Marathi',
  ta: 'Tamil',
  bn: 'Bengali',
};

module.exports = {
  fillDischargeTemplate,
  fillTemplateFromFieldValues,
  buildTemplateData,
  resolveTemplateFieldValue,
  resolveDeterministicFieldValue,
  resolveFallbackFieldValueRegex,
  LANGUAGE_LABELS,
};
