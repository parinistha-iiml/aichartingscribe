const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const prisma = require('./db');
const { templatizePdf, templatizeFlatText } = require('./templatize');
const azure = require('./azureAI');
const groq = require('./groqAI');
const blob = require('./blobStorage');
const { buildPatientSummary, buildDischargeSummary } = require('./clinicalKnowledge');
const { extractTemplateFields } = require('./templateFields');
const {
  fillDischargeTemplate,
  fillTemplateFromFieldValues,
  buildTemplateData,
  resolveTemplateFieldValue,
  resolveDeterministicFieldValue,
  resolveFallbackFieldValueRegex,
  LANGUAGE_LABELS,
} = require('./templateData');

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

function sanitizeDoctor(d) {
  if (!d) return d;
  const { passwordHash, ...rest } = d;
  return rest;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Auth ----
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, specialty } = req.body;
  if (!name || !email || !password || !specialty) {
    return res.status(400).json({ error: 'name, email, password, and specialty are required' });
  }
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = await prisma.doctor.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const doctor = await prisma.doctor.create({
    data: { name, email: email.toLowerCase(), passwordHash, specialty },
  });
  res.json(sanitizeDoctor(doctor));
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const doctor = await prisma.doctor.findUnique({ where: { email: email.toLowerCase() } });
  if (!doctor || !bcrypt.compareSync(password, doctor.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json(sanitizeDoctor(doctor));
});

// ---- Serialization: DB's flat columns -> the nested shape the frontend expects ----
function serializeEncounter(e) {
  const hasAiNote = e.aiDiagnosis !== null && e.aiDiagnosis !== undefined;
  return {
    id: e.id,
    patientId: e.patientId,
    doctorId: e.doctorId,
    rawTranscript: e.rawTranscript,
    dictationLog: (e.dictationLogs || []).map((d) => ({
      id: d.id,
      doctorId: d.doctorId,
      audioUrl: d.audioUrl,
      transcript: d.transcript,
      createdAt: d.createdAt,
    })),
    structuredNote: {
      symptoms: e.symptoms,
      meds: e.meds,
      diagnosis: e.diagnosis,
      icd10: e.icd10,
    },
    templateId: e.templateId,
    dischargeSummary: e.dischargeSummary,
    patientSummary: e.patientSummary,
    translatedSummary: e.translatedSummary,
    targetLanguage: e.targetLanguage,
    status: e.status,
    makerSubmittedAt: e.makerSubmittedAt,
    checkerId: e.checkerId,
    checkerApprovedAt: e.checkerApprovedAt,
    checkerNote: e.checkerNote,
    createdAt: e.createdAt,
    auditLog: (e.auditLog || []).map((a) => ({
      timestamp: a.timestamp,
      doctor: a.doctor,
      field: a.field,
      before: a.before,
      after: a.after,
    })),
    aiOriginal: {
      ...(hasAiNote
        ? { structuredNote: { symptoms: e.aiSymptoms, meds: e.aiMeds, diagnosis: e.aiDiagnosis, icd10: e.aiIcd10 } }
        : {}),
      ...(e.aiDischargeSummary != null ? { dischargeSummary: e.aiDischargeSummary } : {}),
      ...(e.aiPatientSummary != null ? { patientSummary: e.aiPatientSummary } : {}),
    },
  };
}

const encounterInclude = {
  auditLog: { orderBy: { timestamp: 'asc' } },
  dictationLogs: { orderBy: { createdAt: 'asc' } },
};

async function loadEncounter(id) {
  return prisma.encounter.findUnique({ where: { id }, include: encounterInclude });
}

async function doctorName(id) {
  const d = await prisma.doctor.findUnique({ where: { id } });
  return d ? d.name : 'Unknown';
}

// ---- Reference data ----
app.get('/api/doctors', async (req, res) => res.json((await prisma.doctor.findMany()).map(sanitizeDoctor)));
app.get('/api/patients', async (req, res) => res.json(await prisma.patient.findMany({ orderBy: { name: 'asc' } })));
app.post('/api/patients', async (req, res) => {
  const { name, age, priorVisitSummary } = req.body;
  if (!name || !age) return res.status(400).json({ error: 'name and age are required' });
  const patient = await prisma.patient.create({
    data: { name, age: Number(age), priorVisitSummary: priorVisitSummary || 'New patient — no prior visit history on file.' },
  });
  res.json(patient);
});
app.get('/api/patients/:id', async (req, res) => {
  const p = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ error: 'Patient not found' });
  res.json(p);
});

// Pre-consult brief (M0): built from the patient's most recent APPROVED
// encounter when one exists (real follow-up context), falling back to the
// static seeded summary for a first-ever visit.
app.get('/api/patients/:id/preconsult', async (req, res) => {
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const last = await prisma.encounter.findFirst({
    where: { patientId: patient.id, status: 'approved' },
    orderBy: { createdAt: 'desc' },
  });

  if (!last) {
    return res.json({
      patientName: patient.name,
      source: 'seed',
      lines: patient.priorVisitSummary.split(/\.\s*/).filter(Boolean).slice(0, 3).map((l) => `${l.trim()}.`),
    });
  }

  res.json({
    patientName: patient.name,
    source: 'history',
    lastVisitDate: last.createdAt,
    lines: [
      `Last visit: ${last.diagnosis || 'diagnosis not recorded'}.`,
      `On discharge medications: ${(last.meds || []).join(', ') || 'none recorded'}.`,
      `Patient-facing summary given: "${(last.patientSummary || '').split('\n')[0] || 'not recorded'}"`,
    ],
  });
});

// Patient history — past encounters, for follow-up reference. Includes
// the full clinical discharge document, the dictation audio (real Vercel
// Blob URLs when storage is configured), and the audit trail per
// encounter — not just a diagnosis/meds summary.
app.get('/api/patients/:id/history', async (req, res) => {
  const patient = await prisma.patient.findUnique({ where: { id: req.params.id } });
  if (!patient) return res.status(404).json({ error: 'Patient not found' });

  const encounters = await prisma.encounter.findMany({
    where: { patientId: patient.id },
    orderBy: { createdAt: 'desc' },
    include: {
      doctor: true,
      dictationLogs: { orderBy: { createdAt: 'asc' } },
      auditLog: { orderBy: { timestamp: 'asc' } },
    },
  });

  res.json({
    patient,
    encounters: encounters.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      status: e.status,
      doctorName: e.doctor.name,
      diagnosis: e.diagnosis,
      meds: e.meds,
      dischargeSummary: e.dischargeSummary,
      patientSummary: e.patientSummary,
      translatedSummary: e.translatedSummary,
      targetLanguage: e.targetLanguage,
      recordings: e.dictationLogs.map((d) => ({
        id: d.id,
        audioUrl: d.audioUrl, // null when Vercel Blob wasn't configured at dictation time
        createdAt: d.createdAt,
      })),
      auditLog: e.auditLog.map((a) => ({
        timestamp: a.timestamp,
        doctor: a.doctor,
        field: a.field,
        before: a.before,
        after: a.after,
      })),
    })),
  });
});

// ---- Discharge templates (hospital-uniform format, uploaded once, reused) ----
app.get('/api/templates', async (req, res) => {
  res.json(await prisma.dischargeTemplate.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } }));
});

app.post('/api/templates', async (req, res) => {
  const { name, templateText, doctorId } = req.body;
  if (!name || !templateText || !doctorId) {
    return res.status(400).json({ error: 'name, templateText, and doctorId are required' });
  }
  const template = await prisma.dischargeTemplate.create({
    data: { name, templateText, uploadedById: doctorId },
  });
  res.json(template);
});

// Upload an existing hospital discharge document (PDF with a text layer, or
// a scanned image) and get back a genericized, reviewable template draft.
// This does NOT save anything — nothing from the source document (or the
// patient it belonged to) is persisted until the doctor reviews the draft
// below and explicitly saves it via POST /api/templates.
app.post('/api/templates/from-document', upload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No document uploaded (field name: "document")' });

  try {
    if (req.file.mimetype === 'application/pdf') {
      const { templateText, detectedFields, warnings } = await templatizePdf(req.file.buffer);
      return res.json({
        suggestedName: `${req.file.originalname.replace(/\.[^.]+$/, '')} (from upload)`,
        templateText,
        detectedFields,
        warnings,
      });
    }
    if (req.file.mimetype.startsWith('image/')) {
      if (!azure.isConfigured.documentIntelligence()) {
        return res.status(503).json({
          error: 'Azure AI Document Intelligence is not configured — set AZURE_DOCUMENT_INTELLIGENCE_KEY and AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT in server/.env to OCR scanned images, or upload a PDF with a text layer instead (that path works without it). See README for setup steps.',
        });
      }
      const rawText = await azure.azureOcrImage(req.file.buffer, req.file.mimetype);
      const { templateText, detectedFields } = templatizeFlatText(rawText);
      return res.json({
        suggestedName: `${req.file.originalname.replace(/\.[^.]+$/, '')} (from upload)`,
        templateText,
        detectedFields,
        warnings: ["Auto-generated via Azure AI Document Intelligence OCR — review every line before saving. Confirm no patient name, ID, phone number, or address remains anywhere in the text below."],
      });
    }
    return res.status(400).json({ error: 'Upload a PDF or an image (jpg/png).' });
  } catch (e) {
    return res.status(422).json({ error: `Could not read this document: ${e.message}` });
  }
});

// ---- Encounters ----
app.post('/api/encounter', async (req, res) => {
  const { patientId, doctorId } = req.body;
  if (!patientId || !doctorId) return res.status(400).json({ error: 'patientId and doctorId required' });
  const encounter = await prisma.encounter.create({ data: { patientId, doctorId } });
  res.json(serializeEncounter({ ...encounter, auditLog: [], dictationLogs: [] }));
});

app.get('/api/encounter/:id', async (req, res) => {
  const e = await loadEncounter(req.params.id);
  if (!e) return res.status(404).json({ error: 'Encounter not found' });
  res.json(serializeEncounter(e));
});

// Reviewable dictation log for this encounter
app.get('/api/encounter/:id/dictation-log', async (req, res) => {
  const logs = await prisma.dictationLog.findMany({
    where: { encounterId: req.params.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json(logs);
});

// M1/M2 — transcribe (Azure AI Speech). Each call APPENDS a new dictation
// take rather than overwriting — doctors may dictate in more than one pass
// (addenda, corrections), and every take stays reviewable. The audio
// itself is uploaded to Vercel Blob (when configured) so it can be played
// back later from Visit History — transcription alone used to discard it.
app.post('/api/encounter/:id/transcribe', upload.single('audio'), async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Encounter not found' });

  if (!azure.isConfigured.speech()) {
    return res.status(503).json({
      error: 'Azure AI Speech is not configured — set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in server/.env. See README for setup steps.',
    });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No audio uploaded (field name: "audio")' });
  }

  let transcript;
  try {
    transcript = await azure.azureTranscribe(req.file.buffer, req.file.mimetype);
  } catch (e) {
    return res.status(502).json({ error: `Azure Speech transcription failed: ${e.message}` });
  }

  let audioUrl = null;
  if (blob.isConfigured.blob()) {
    try {
      audioUrl = await blob.uploadDictationAudio(existing.id, req.file.buffer, req.file.mimetype);
    } catch (e) {
      // Don't fail the whole request over storage — the transcript is the
      // clinically important part and already succeeded. Surface the
      // failure honestly instead of pretending the audio was saved.
      console.error(`Vercel Blob upload failed for encounter ${existing.id}: ${e.message}`);
    }
  }

  await prisma.dictationLog.create({
    data: {
      encounterId: existing.id,
      doctorId: req.body.doctorId || existing.doctorId,
      audioUrl,
      transcript,
    },
  });

  const allLogs = await prisma.dictationLog.findMany({
    where: { encounterId: existing.id },
    orderBy: { createdAt: 'asc' },
  });
  const rawTranscript = allLogs.map((l) => l.transcript).join('\n\n---\n\n');

  await prisma.encounter.update({ where: { id: existing.id }, data: { rawTranscript, status: 'draft' } });
  res.json({ rawTranscript, dictationLog: allLogs });
});

// M3/M4 — structure (Text Analytics for Health)
app.post('/api/encounter/:id/structure', async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Encounter not found' });
  const rawTranscript = req.body.rawTranscript || existing.rawTranscript;

  if (!rawTranscript || !rawTranscript.trim()) {
    return res.status(400).json({ error: 'No dictation recorded yet for this encounter — record and transcribe at least one take before structuring.' });
  }
  if (!azure.isConfigured.language()) {
    return res.status(503).json({
      error: 'Azure AI Language (Text Analytics for Health) is not configured — set AZURE_LANGUAGE_KEY and AZURE_LANGUAGE_ENDPOINT in server/.env. See README for setup steps.',
    });
  }

  let structuredNote;
  try {
    structuredNote = await azure.azureStructureNote(rawTranscript);
  } catch (e) {
    return res.status(502).json({ error: `Azure Text Analytics for Health failed: ${e.message}` });
  }

  const data = {
    symptoms: structuredNote.symptoms,
    meds: structuredNote.meds,
    diagnosis: structuredNote.diagnosis,
    icd10: structuredNote.icd10,
  };
  // Preserve the first AI-generated version for the Review & Approve diff.
  if (existing.aiDiagnosis === null) {
    data.aiSymptoms = structuredNote.symptoms;
    data.aiMeds = structuredNote.meds;
    data.aiDiagnosis = structuredNote.diagnosis;
    data.aiIcd10 = structuredNote.icd10;
  }
  await prisma.encounter.update({ where: { id: req.params.id }, data });
  res.json({ structuredNote });
});

// Maps the CANONICAL extracted entities onto a SPECIFIC template's own
// fields — this is the "next step" that turns generic structured entities
// into exactly the fields the chosen hospital document needs, so the
// doctor reviews/edits the real fields ("Name of Patient", "IP No",
// "Final Diagnosis"...) instead of a fixed generic shape that then has to
// be reverse-mapped at fill time.
//
// Fields with a fixed clinical/administrative concept (patient name, age,
// diagnosis, ICD-10, medications, symptoms, doctor name, date) resolve
// deterministically from data we already have exactly — never sent to an
// LLM. Every other field (Investigations, Diet, Physical activity,
// Miscellaneous, follow-up instructions, whatever a given hospital's
// template calls its own sections) has no fixed concept and needs real
// free-text understanding of the transcript: if GROQ_API_KEY is
// configured, those are mapped in one batched call to the real Groq API
// (see groqAI.js); otherwise they fall back to the keyword/regex matcher
// in templateData.js. Either way this is real extraction from the actual
// dictation — nothing here is mocked or fabricated.
app.post('/api/encounter/:id/template-fields', async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Encounter not found' });
  const { templateId, structuredNote } = req.body;
  if (!templateId) return res.status(400).json({ error: 'templateId required' });

  const [template, patient, doctor] = await Promise.all([
    prisma.dischargeTemplate.findUnique({ where: { id: templateId } }),
    prisma.patient.findUnique({ where: { id: existing.patientId } }),
    prisma.doctor.findUnique({ where: { id: existing.doctorId } }),
  ]);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const note = structuredNote || {
    symptoms: existing.symptoms,
    meds: existing.meds,
    diagnosis: existing.diagnosis,
    icd10: existing.icd10,
  };

  const rawFields = extractTemplateFields(template.templateText); // [{slug, label}]

  const deterministic = [];
  const needsFallback = [];
  for (const f of rawFields) {
    const value = resolveDeterministicFieldValue(f.slug, { patient, doctor, structuredNote: note });
    if (value !== undefined) {
      deterministic.push({ ...f, value });
    } else {
      needsFallback.push(f);
    }
  }

  let mappingMethod = 'regex';
  const fallbackValues = {};
  if (needsFallback.length) {
    if (groq.isConfigured.groq()) {
      mappingMethod = 'groq';
      try {
        const mapped = await groq.groqMapTemplateFields(needsFallback, existing.rawTranscript);
        Object.assign(fallbackValues, mapped);
      } catch (e) {
        return res.status(502).json({ error: `Groq field mapping failed: ${e.message}` });
      }
    } else {
      for (const f of needsFallback) {
        fallbackValues[f.slug] = resolveFallbackFieldValueRegex(f.slug, { rawTranscript: existing.rawTranscript, label: f.label });
      }
    }
  }

  const fields = rawFields.map((f) => {
    const det = deterministic.find((d) => d.slug === f.slug);
    return det || { slug: f.slug, label: f.label, value: fallbackValues[f.slug] || '' };
  });

  res.json({ templateName: template.name, fields, fieldMappingMethod: mappingMethod });
});

// Discharge summary — fills the hospital's uploaded template when
// templateId is given. If the doctor has already reviewed/confirmed the
// template's own fields (via /template-fields above), those values are
// used directly — straight substitution, no guessing. Falls back to the
// alias-based mapping only if fieldValues weren't supplied (e.g. an older
// client, or the generic no-review path), and to a deterministic
// clinical-format draft when no template is selected at all.
// otherwise builds a deterministic clinical-format draft from those same
// real entities. No generative model involved — this is template
// population from real NLP output, not text generation, and doesn't need
// one to be correct.
app.post('/api/encounter/:id/discharge', async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Encounter not found' });
  const structuredNote = req.body.structuredNote || {
    symptoms: existing.symptoms,
    meds: existing.meds,
    diagnosis: existing.diagnosis,
    icd10: existing.icd10,
  };

  let dischargeSummary;
  const templateId = req.body.templateId ?? existing.templateId;
  const templateFieldValues = req.body.templateFieldValues; // { slug: value }, doctor-confirmed
  if (templateId) {
    const template = await prisma.dischargeTemplate.findUnique({ where: { id: templateId } });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    if (templateFieldValues) {
      dischargeSummary = fillTemplateFromFieldValues(template.templateText, templateFieldValues);
    } else {
      // Fallback: no reviewed field values supplied — resolve via the
      // alias map directly, same as before /template-fields existed.
      const [patient, doctor] = await Promise.all([
        prisma.patient.findUnique({ where: { id: existing.patientId } }),
        prisma.doctor.findUnique({ where: { id: existing.doctorId } }),
      ]);
      const data = buildTemplateData({ patient, doctor, structuredNote });
      dischargeSummary = fillDischargeTemplate(template.templateText, data);
    }
  } else {
    dischargeSummary = buildDischargeSummary(structuredNote);
  }

  const data = { dischargeSummary, templateId: templateId || null };
  if (existing.aiDischargeSummary === null) data.aiDischargeSummary = dischargeSummary;
  await prisma.encounter.update({ where: { id: req.params.id }, data });
  res.json({ dischargeSummary });
});

// Patient-facing plain-language summary — built the same way: real
// diagnosis/medication entities (from Text Analytics for Health) run
// through a curated plain-language phrase lookup. See the disclaimer at
// the top of clinicalKnowledge.js — this content needs clinical review
// before it reaches a real patient; the pipeline producing it is real.
app.post('/api/encounter/:id/patient-summary', async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Encounter not found' });
  const structuredNote = req.body.structuredNote || {
    symptoms: existing.symptoms,
    meds: existing.meds,
    diagnosis: existing.diagnosis,
    icd10: existing.icd10,
  };

  const patientSummary = buildPatientSummary(structuredNote, existing.rawTranscript);
  const data = { patientSummary };
  if (existing.aiPatientSummary === null) data.aiPatientSummary = patientSummary;
  await prisma.encounter.update({ where: { id: req.params.id }, data });
  res.json({ patientSummary });
});

// Translate the ALREADY-simplified patient summary (Azure AI Translator)
app.post('/api/encounter/:id/translate', async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Encounter not found' });
  const { patientSummary, targetLanguage } = req.body;
  const source = patientSummary || existing.patientSummary;
  if (!source) return res.status(400).json({ error: 'No patient summary to translate — simplify first' });
  if (!LANGUAGE_LABELS[targetLanguage]) {
    return res.status(400).json({ error: `Unsupported language "${targetLanguage}". Supported: ${Object.keys(LANGUAGE_LABELS).join(', ')}` });
  }
  if (!azure.isConfigured.translator()) {
    return res.status(503).json({
      error: 'Azure AI Translator is not configured — set AZURE_TRANSLATOR_KEY and AZURE_TRANSLATOR_REGION in server/.env. See README for setup steps.',
    });
  }

  let translatedSummary;
  try {
    translatedSummary = await azure.azureTranslate(source, targetLanguage);
  } catch (e) {
    return res.status(502).json({ error: `Azure Translator failed: ${e.message}` });
  }

  await prisma.encounter.update({ where: { id: req.params.id }, data: { translatedSummary, targetLanguage } });
  res.json({ translatedSummary, targetLanguage });
});

// ---- Approval (single-stage — no separate maker/checker roles) ----

// The dictating doctor finalizes their edits and approves the encounter
// directly — no separate checker sign-off. Records what changed (AI draft
// vs. doctor-edited) in the audit trail same as before, then marks the
// encounter approved in one step.
app.put('/api/encounter/:id/approve', async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Encounter not found' });
  const { structuredNote, dischargeSummary, patientSummary, translatedSummary, doctorId } = req.body;
  const dName = await doctorName(doctorId || existing.doctorId);

  const auditEntries = [];
  const data = {};

  if (structuredNote) {
    const before = JSON.stringify({ symptoms: existing.symptoms, meds: existing.meds, diagnosis: existing.diagnosis, icd10: existing.icd10 });
    const after = JSON.stringify(structuredNote);
    if (before !== after) {
      auditEntries.push({ doctor: dName, field: 'structuredNote', before, after });
      Object.assign(data, { symptoms: structuredNote.symptoms, meds: structuredNote.meds, diagnosis: structuredNote.diagnosis, icd10: structuredNote.icd10 });
    }
  }
  if (dischargeSummary && dischargeSummary !== existing.dischargeSummary) {
    auditEntries.push({ doctor: dName, field: 'dischargeSummary', before: existing.dischargeSummary, after: dischargeSummary });
    data.dischargeSummary = dischargeSummary;
  }
  if (patientSummary && patientSummary !== existing.patientSummary) {
    auditEntries.push({ doctor: dName, field: 'patientSummary', before: existing.patientSummary, after: patientSummary });
    data.patientSummary = patientSummary;
  }
  if (translatedSummary && translatedSummary !== existing.translatedSummary) {
    auditEntries.push({ doctor: dName, field: 'translatedSummary', before: existing.translatedSummary, after: translatedSummary });
    data.translatedSummary = translatedSummary;
  }

  data.status = 'approved';
  // Reuses the checker* columns to record who approved and when, now that
  // approval is single-stage — there's no separate checker role anymore.
  data.checkerId = doctorId || existing.doctorId;
  data.checkerApprovedAt = new Date();
  data.checkerNote = null;
  auditEntries.push({ doctor: dName, field: 'status', before: existing.status, after: 'approved' });

  await prisma.$transaction([
    prisma.encounter.update({ where: { id: req.params.id }, data }),
    prisma.auditLogEntry.createMany({ data: auditEntries.map((a) => ({ ...a, encounterId: req.params.id })) }),
  ]);

  res.json(serializeEncounter(await loadEncounter(req.params.id)));
});

app.get('/api/encounter/:id/audit-log', async (req, res) => {
  const e = await loadEncounter(req.params.id);
  if (!e) return res.status(404).json({ error: 'Encounter not found' });
  res.json(serializeEncounter(e).auditLog);
});

app.get('/api/health', async (req, res) => {
  const services = {
    speech: azure.isConfigured.speech() ? 'configured' : 'NOT CONFIGURED — transcription will fail',
    textAnalyticsForHealth: azure.isConfigured.language() ? 'configured' : 'NOT CONFIGURED — structuring will fail',
    documentIntelligenceOcr: azure.isConfigured.documentIntelligence()
      ? 'configured'
      : 'NOT CONFIGURED — scanned-image template upload will fail (PDF template upload still works, no Azure needed for that path)',
    dischargeAndPatientSummary: 'template + entity population from real extracted data (deterministic, no external call — not mocked)',
    translator: azure.isConfigured.translator() ? 'configured' : 'NOT CONFIGURED — translation will fail',
    groqTemplateFieldMapping: groq.isConfigured.groq()
      ? 'configured — free-text template fields (Investigations, Diet, Miscellaneous, etc.) mapped via real Groq API call'
      : 'NOT CONFIGURED — falls back to keyword/regex matching for free-text template fields. Set GROQ_API_KEY in server/.env for LLM-based mapping.',
    dictationAudioStorage: blob.isConfigured.blob()
      ? 'configured — Vercel Blob'
      : 'NOT CONFIGURED — dictation audio is not saved anywhere and cannot be played back later. Set BLOB_READ_WRITE_TOKEN in server/.env.',
  };
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'connected', services });
  } catch (e) {
    res.status(500).json({ ok: false, db: 'error', error: e.message, services });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  const svc = (name, ok) => `${name}=${ok ? 'CONFIGURED' : 'NOT CONFIGURED'}`;
  console.log(
    `AI Charting Scribe backend listening on :${PORT} — ` +
      [
        svc('speech', azure.isConfigured.speech()),
        svc('textAnalyticsHealth', azure.isConfigured.language()),
        svc('documentIntelligenceOcr', azure.isConfigured.documentIntelligence()),
        'dischargeAndPatientSummary=template+entity(real,no-LLM)',
        svc('translator', azure.isConfigured.translator()),
        svc('groqTemplateFieldMapping', groq.isConfigured.groq()),
        svc('dictationAudioStorage', blob.isConfigured.blob()),
      ].join(', ')
  );
});

// Exported so a Vercel serverless function (see /api/index.js at the repo
// root) can require this file directly and get the Express app as a
// request handler. app.listen() above still runs on import — harmless on
// Vercel (nothing binds to that port in the serverless runtime) and keeps
// `node index.js` / `npm start` working unchanged for local development.
module.exports = app;