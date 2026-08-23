// Fallbacks used ONLY when the corresponding Azure service isn't
// configured (no key in .env) — see server/azureAI.js for the real calls
// and server/index.js for the per-service real/fallback switch.
//
// Two genuine Azure-service stand-ins live here: transcription (Speech)
// and structuring (Text Analytics for Health). Discharge-summary and
// patient-summary generation are NOT here — those moved to
// clinicalKnowledge.js, because they were never actually an Azure-service
// call in the first place once a hospital template exists: they're
// template/entity population, not generation, so they don't have a
// "mock vs real service" distinction to make.

const MOCK_MODE = process.env.MOCK_MODE !== 'false'; // default true

// A small bank of synthetic dictations so demo output varies a bit by
// patient — used only when AZURE_SPEECH_KEY/AZURE_SPEECH_REGION aren't set.
const TRANSCRIPT_BANK = {
  'pat-1':
    "Patient presents today with mild headache and occasional dizziness over the past week. Blood pressure today one forty two over ninety. Continuing on Amlodipine five milligrams once daily. Advising to increase to Amlodipine ten milligrams once daily and recheck in two weeks. Discussed reducing salt intake and daily walking for thirty minutes. No chest pain, no shortness of breath. Diagnosis: uncontrolled hypertension. Follow up in two weeks with repeat BP check.",
  'pat-2':
    "Patient reports fatigue and increased thirst over the last two weeks. Fasting glucose today one sixty eight. Currently on Metformin five hundred milligrams twice daily. Plan to increase Metformin to one thousand milligrams twice daily and add Glimepiride one milligram once daily before breakfast. Counseled on diet and reviewed foot care. Diagnosis: type two diabetes mellitus, suboptimal control. Follow up in four weeks with repeat HbA1c.",
  'pat-3':
    "Patient describes lower back pain radiating occasionally to the left leg, worse with prolonged sitting, for about six weeks now. No history of trauma. On examination, mild tenderness over the lower lumbar region, straight leg raise negative. Prescribing Naproxen five hundred milligrams twice daily for seven days and a short course of physiotherapy. Diagnosis: mechanical low back pain. Advised to avoid heavy lifting and follow up in two weeks if not improving.",
  'pat-4':
    "Patient presents with sneezing, itchy eyes and nasal congestion, worse in the mornings, ongoing for about ten days. No fever. Prescribing Cetirizine ten milligrams once daily at night and a saline nasal spray twice daily. Diagnosis: allergic rhinitis, seasonal. Advised to avoid known triggers and follow up only if symptoms persist beyond two weeks.",
};

const DEFAULT_TRANSCRIPT =
  "Patient presents with mild fever and sore throat for three days. No difficulty breathing. Prescribing Paracetamol six fifty milligrams as needed and Azithromycin five hundred milligrams once daily for three days. Diagnosis: acute pharyngitis. Advised rest, fluids, and follow up in five days if symptoms worsen.";

function mockTranscribe(patientId) {
  return TRANSCRIPT_BANK[patientId] || DEFAULT_TRANSCRIPT;
}

// Simple keyword-based extraction — fallback only, used when
// AZURE_LANGUAGE_KEY/AZURE_LANGUAGE_ENDPOINT aren't set. The real path
// (server/azureAI.js -> azureStructureNote) calls actual Text Analytics
// for Health and returns entities the service extracted, not regex guesses.
function mockStructure(rawTranscript) {
  const text = rawTranscript.toLowerCase();

  const meds = [];
  const medPatterns = [
    { re: /amlodipine (\w+ ?\w*)/, name: 'Amlodipine' },
    { re: /metformin (\w+ ?\w*)/, name: 'Metformin' },
    { re: /glimepiride (\w+ ?\w*)/, name: 'Glimepiride' },
    { re: /naproxen (\w+ ?\w*)/, name: 'Naproxen' },
    { re: /cetirizine (\w+ ?\w*)/, name: 'Cetirizine' },
    { re: /paracetamol (\w+ ?\w*)/, name: 'Paracetamol' },
    { re: /azithromycin (\w+ ?\w*)/, name: 'Azithromycin' },
  ];
  medPatterns.forEach(({ re, name }) => {
    const m = text.match(re);
    if (m) meds.push(`${name} ${m[1].trim()}`);
  });

  const symptoms = [];
  ['headache', 'dizziness', 'fatigue', 'thirst', 'back pain', 'sneezing', 'itchy eyes', 'nasal congestion', 'fever', 'sore throat', 'chest pain', 'shortness of breath']
    .forEach((s) => {
      const idx = text.indexOf(s);
      if (idx === -1) return;
      const precedingWindow = text.slice(Math.max(0, idx - 8), idx);
      if (/\bno\s+$/.test(precedingWindow)) return; // skip explicitly negated findings, e.g. "no chest pain"
      symptoms.push(s.charAt(0).toUpperCase() + s.slice(1));
    });

  let diagnosis = 'Diagnosis pending review';
  let icd10 = [];
  const diagMatch = rawTranscript.match(/[Dd]iagnosis:\s*([^.]+)\./);
  if (diagMatch) diagnosis = diagMatch[1].trim();

  if (/hypertension/i.test(diagnosis)) icd10 = ['I10'];
  else if (/diabetes/i.test(diagnosis)) icd10 = ['E11.9'];
  else if (/back pain/i.test(diagnosis)) icd10 = ['M54.5'];
  else if (/rhinitis/i.test(diagnosis)) icd10 = ['J30.9'];
  else if (/pharyngitis/i.test(diagnosis)) icd10 = ['J02.9'];

  return {
    symptoms: symptoms.length ? symptoms : ['Not clearly specified'],
    meds: meds.length ? meds : ['None documented'],
    diagnosis,
    icd10,
  };
}

// Fills a hospital-uploaded discharge template's {{placeholders}} using the
// structured note + patient/doctor/date context. Unknown placeholders are
// left as-is (visible as {{placeholder}}) so the reviewing doctor notices
// anything the template expects that wasn't supplied. This is real,
// always-on logic — not a mock — used regardless of which Azure services
// are configured.
function fillDischargeTemplate(templateText, data) {
  return templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = data[key];
    if (value === undefined || value === null) return match;
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

// Fallback translation — used only when AZURE_TRANSLATOR_KEY/REGION aren't
// set. The real path (azureAI.js -> azureTranslate) calls actual Azure AI
// Translator.
const LANGUAGE_LABELS = {
  hi: 'Hindi',
  mr: 'Marathi',
  ta: 'Tamil',
  bn: 'Bengali',
};

function mockTranslate(patientSummary, targetLanguage) {
  const label = LANGUAGE_LABELS[targetLanguage] || targetLanguage;
  return `[Translated to ${label} — demo mock, no AZURE_TRANSLATOR_KEY configured]\n\n${patientSummary}`;
}

module.exports = {
  MOCK_MODE,
  mockTranscribe,
  mockStructure,
  fillDischargeTemplate,
  buildTemplateData,
  mockTranslate,
  LANGUAGE_LABELS,
};
