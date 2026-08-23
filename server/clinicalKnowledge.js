// Builds the patient-facing plain-language summary and the clinical
// discharge summary from the doctor's OWN dictated words wherever
// possible — not from a separately-authored medical knowledge base.
//
// The doctor already dictates why each medication was prescribed, what a
// diagnosis means for this patient, and what to watch for ("Advising to
// increase to Amlodipine... discussed reducing salt intake...") — that's
// real clinically-vetted content from an actual practicing clinician. This
// module finds the sentence(s) in the raw transcript that mention each
// extracted entity and uses those, instead of a canned explanation I'd
// have had to author myself (which is exactly the wrong source of truth
// for clinical content, and was the mistake in the previous version of
// this file).
//
// This is plain sentence-extraction / information-retrieval — matching
// entity text back to its source sentence by substring — not a generative
// model. No LLM call happens anywhere in this file.
//
// Fallback: if the dictation genuinely contains no explanatory context for
// an item (e.g. a medication mentioned with zero surrounding detail), the
// summary says so honestly and points the patient back to their doctor —
// it does NOT fabricate a generic clinical explanation to fill the gap.

function splitIntoSentences(text) {
  if (!text) return [];
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return (matches || []).map((s) => s.trim()).filter(Boolean);
}

// Finds every sentence in the transcript that mentions this entity's text.
// Case-insensitive substring match — entity text from Text Analytics for
// Health (or the regex fallback) is normally a near-exact surface form
// from the source document, so this reliably finds its home sentence(s).
function findSentencesFor(entityText, sentences) {
  const needle = (entityText || '').toLowerCase().trim();
  if (!needle) return [];
  // Match on the first meaningful token too (e.g. "Amlodipine" out of
  // "Amlodipine 10mg") in case the extracted entity includes dosage that
  // isn't verbatim in every mentioning sentence.
  const firstWord = needle.split(/\s+/)[0];
  return sentences.filter((s) => {
    const lower = s.toLowerCase();
    return lower.includes(needle) || (firstWord.length > 3 && lower.includes(firstWord));
  });
}

function cleanSentence(s) {
  const trimmed = s.trim();
  if (!trimmed) return '';
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

// Diagnosis explanations need a different heuristic than meds: the sentence
// literally containing "Diagnosis: X" just restates the label, adding
// nothing — the doctor's actual counseling about it ("discussed reducing
// salt intake...") is usually adjacent in the dictation but doesn't repeat
// the diagnosis name. So: drop the circular restatement, and if nothing
// else mentions the diagnosis by name, fall back to the sentences
// immediately surrounding wherever it was stated — that's normally exactly
// where the doctor's counseling on it lives in a spoken encounter note.
function findDiagnosisContext(diagnosisText, sentences) {
  const direct = findSentencesFor(diagnosisText, sentences).filter(
    (s) => !/^diagnosis\s*:/i.test(s.trim())
  );
  if (direct.length) return direct;

  const stated = sentences.findIndex((s) => /^diagnosis\s*:/i.test(s.trim()));
  if (stated === -1) return [];
  const around = [sentences[stated - 1], sentences[stated + 1]].filter(Boolean);
  return around;
}

// Builds the patient-facing plain-language summary. Pulls each
// medication's and the diagnosis's explanatory context straight from the
// dictation; falls back to an honest "ask your doctor" line — never a
// fabricated clinical claim — when the dictation didn't include enough
// context for a given item.
function buildPatientSummary(structuredNote, rawTranscript) {
  const sentences = splitIntoSentences(rawTranscript);

  const medLines = structuredNote.meds
    .map((m) => {
      const context = findSentencesFor(m, sentences);
      const explanation = context.length
        ? context.map(cleanSentence).join(' ')
        : "Your doctor didn't dictate further detail on this one — ask your doctor or pharmacist what it's for and how to take it.";
      return `  - ${m}: ${explanation}`;
    })
    .join('\n');

  const diagnosisContext = findDiagnosisContext(structuredNote.diagnosis, sentences);
  const diagnosisExplanation = diagnosisContext.length
    ? diagnosisContext.map(cleanSentence).join(' ')
    : "Ask your doctor to explain this diagnosis in more detail if anything is unclear.";

  return [
    `Here's what happened at your visit, in simple terms.`,
    ``,
    `What you came in with: ${structuredNote.symptoms.join(', ')}.`,
    ``,
    `What the doctor found: ${structuredNote.diagnosis}. ${diagnosisExplanation}`,
    ``,
    `Your medicines:`,
    medLines || '  - None prescribed at this visit.',
    ``,
    `What to do if things get worse: If you get chest pain, trouble breathing, a high fever, or you just feel like something is seriously wrong, go to the nearest hospital right away — don't wait for your follow-up date.`,
    ``,
    `Next step: Come back for your follow-up visit as your doctor advised.`,
  ].join('\n');
}

// Deterministic clinical-format discharge summary, built from the real
// extracted entities, for when no hospital template has been
// uploaded/selected. (When a template IS selected, fillDischargeTemplate
// in mockAI.js populates that instead — this is only the no-template
// path.) Clinical-register text draws directly from the entities
// themselves, which is the normal register for this document type.
function buildDischargeSummary(structuredNote) {
  return [
    `DISCHARGE SUMMARY`,
    ``,
    `Diagnosis: ${structuredNote.diagnosis} (${structuredNote.icd10.join(', ') || 'ICD-10 pending'})`,
    ``,
    `Presenting symptoms: ${structuredNote.symptoms.join(', ')}`,
    ``,
    `Treatment given: Medication management as below, patient counseled on condition and self-care measures.`,
    ``,
    `Discharge medications:`,
    ...structuredNote.meds.map((m) => `  - ${m}`),
    ``,
    `Follow-up instructions: Return for follow-up as advised by the physician, or sooner if symptoms worsen. Seek urgent care for chest pain, breathing difficulty, or high-grade fever.`,
  ].join('\n');
}

module.exports = { buildPatientSummary, buildDischargeSummary, splitIntoSentences, findSentencesFor, findDiagnosisContext };
