// Real Azure AI Services calls — every one of these runs on Azure's
// always-free F0 tier, no paid subscription or payment method required:
//   - Azure AI Speech (STT)                    — F0: ~5 audio hrs/month
//   - Azure AI Language — Text Analytics for Health — F0: 5,000 text records
//   - Azure AI Document Intelligence (OCR)       — F0: 500 pages/month
//   - Azure AI Translator                       — F0: 2M characters/month
//
// There is deliberately no LLM/generative-model call anywhere in this
// pipeline. Discharge-summary and patient-summary generation are template
// + entity population sourced from the doctor's own dictation (see
// clinicalKnowledge.js) — that's an NLP/extraction task, not a
// text-generation task, and doesn't need a model that requires a paid
// Azure AI Foundry deployment to solve correctly. (Azure AI Foundry
// serverless model deployments explicitly require a paid subscription —
// "Free or trial Azure subscriptions won't work" per Microsoft's own
// deployment docs — which is why it's not used here.)
//
// index.js calls these when the corresponding env vars are set, and falls
// back to mockAI.js / templatize.js's flat-text matcher per-service when
// they're not.

const SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const SPEECH_REGION = process.env.AZURE_SPEECH_REGION;

const LANGUAGE_KEY = process.env.AZURE_LANGUAGE_KEY;
const LANGUAGE_ENDPOINT = process.env.AZURE_LANGUAGE_ENDPOINT; // e.g. https://<resource>.cognitiveservices.azure.com

const DOC_INTEL_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
const DOC_INTEL_ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT; // e.g. https://<resource>.cognitiveservices.azure.com

const TRANSLATOR_KEY = process.env.AZURE_TRANSLATOR_KEY;
const TRANSLATOR_REGION = process.env.AZURE_TRANSLATOR_REGION;
const TRANSLATOR_ENDPOINT = process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com';

const isConfigured = {
  speech: () => !!(SPEECH_KEY && SPEECH_REGION),
  language: () => !!(LANGUAGE_KEY && LANGUAGE_ENDPOINT),
  documentIntelligence: () => !!(DOC_INTEL_KEY && DOC_INTEL_ENDPOINT),
  translator: () => !!(TRANSLATOR_KEY && TRANSLATOR_REGION),
};

// ---- Azure AI Speech — speech-to-text (REST, short audio, F0 tier) ----
// https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1
async function azureTranscribe(audioBuffer, mimetype) {
  const url = `https://${SPEECH_REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-IN&format=detailed`;
  // The client (Dictation.jsx -> audioConvert.js) always converts audio to
  // 16kHz mono 16-bit PCM WAV before upload — regardless of the source
  // browser's recording format — specifically so this Content-Type is
  // always correct, rather than depending on whatever the browser/upload
  // reported. If a caller ever sends something else (e.g. a direct API
  // call bypassing the client), the reported mimetype is used as a
  // fallback, but the guaranteed-correct path is the WAV one.
  const isStandardWav = mimetype === 'audio/wav' || mimetype === 'audio/x-wav' || !mimetype;
  const contentType = isStandardWav ? 'audio/wav; codecs=audio/pcm; samplerate=16000' : mimetype;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': SPEECH_KEY,
      'Content-Type': contentType,
      Accept: 'application/json',
    },
    body: audioBuffer,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Azure Speech STT failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.RecognitionStatus && data.RecognitionStatus !== 'Success') {
    throw new Error(`Azure Speech STT returned status "${data.RecognitionStatus}" — no speech recognized`);
  }
  const transcript = data.DisplayText || data.NBest?.[0]?.Display || '';
  if (!transcript.trim()) {
    throw new Error(
      'Azure Speech returned an empty transcript (status was "Success" but no text came back). ' +
        'This usually means the audio was silent, too quiet, or too short — try recording again closer to the mic.'
    );
  }
  return transcript;
}

// ---- Azure AI Language — Text Analytics for Health (async job, F0 tier) ----
async function azureStructureNote(text) {
  const submitUrl = `${LANGUAGE_ENDPOINT.replace(/\/$/, '')}/language/analyze-text/jobs?api-version=2023-04-01`;
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': LANGUAGE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'EHR dictation structuring',
      analysisInput: { documents: [{ id: '1', language: 'en', text }] },
      tasks: [{ kind: 'Healthcare', taskName: 'health task' }],
    }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`Azure Text Analytics for Health submit failed (${submitRes.status}): ${body.slice(0, 300)}`);
  }
  const operationLocation = submitRes.headers.get('operation-location');
  if (!operationLocation) throw new Error('Azure Text Analytics for Health: no operation-location header returned');

  // Poll until the async job completes (short documents typically finish in a few seconds).
  let result;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(operationLocation, { headers: { 'Ocp-Apim-Subscription-Key': LANGUAGE_KEY } });
    if (!pollRes.ok) throw new Error(`Azure Text Analytics for Health poll failed (${pollRes.status})`);
    const pollData = await pollRes.json();
    if (pollData.status === 'succeeded') {
      result = pollData;
      break;
    }
    if (pollData.status === 'failed') {
      throw new Error(`Azure Text Analytics for Health job failed: ${JSON.stringify(pollData.errors || pollData)}`);
    }
  }
  if (!result) throw new Error('Azure Text Analytics for Health job timed out waiting for results');

  const entities = result.tasks?.items?.[0]?.results?.documents?.[0]?.entities || [];
  const symptoms = new Set();
  const meds = new Set();
  const diagnoses = [];
  const icd10 = new Set();

  for (const e of entities) {
    if (e.category === 'SymptomOrSign') symptoms.add(e.text);
    else if (e.category === 'MedicationName') meds.add(e.text);
    else if (e.category === 'Diagnosis') {
      diagnoses.push(e.text);
      for (const link of e.links || []) {
        if (link.dataSource === 'ICD10CM' || link.dataSource === 'ICD-10-CM') icd10.add(link.id);
      }
    }
  }

  return {
    symptoms: symptoms.size ? [...symptoms] : ['Not clearly specified'],
    meds: meds.size ? [...meds] : ['None documented'],
    diagnosis: diagnoses[0] || 'Diagnosis pending review',
    icd10: [...icd10],
  };
}

// ---- Azure AI Document Intelligence — OCR for scanned images (F0 tier) ----
// Async job pattern, same shape as Text Analytics for Health: submit,
// poll Operation-Location until succeeded. prebuilt-read is the base OCR
// model — general text extraction, works on any document/image, no
// training needed. Free tier caps at 500 pages/month and reads only the
// first 2 pages of any single request — fine for a single-page discharge
// form photo.
async function azureOcrImage(imageBuffer, mimetype) {
  const submitUrl = `${DOC_INTEL_ENDPOINT.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`;
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': DOC_INTEL_KEY,
      'Content-Type': mimetype || 'application/octet-stream',
    },
    body: imageBuffer,
  });
  if (submitRes.status !== 202) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`Azure Document Intelligence submit failed (${submitRes.status}): ${body.slice(0, 300)}`);
  }
  const operationLocation = submitRes.headers.get('operation-location');
  if (!operationLocation) throw new Error('Azure Document Intelligence: no operation-location header returned');

  let result;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(operationLocation, { headers: { 'Ocp-Apim-Subscription-Key': DOC_INTEL_KEY } });
    if (!pollRes.ok) throw new Error(`Azure Document Intelligence poll failed (${pollRes.status})`);
    const pollData = await pollRes.json();
    if (pollData.status === 'succeeded') {
      result = pollData;
      break;
    }
    if (pollData.status === 'failed') {
      throw new Error(`Azure Document Intelligence job failed: ${JSON.stringify(pollData.error || pollData)}`);
    }
  }
  if (!result) throw new Error('Azure Document Intelligence job timed out waiting for results');

  return result.analyzeResult?.content || '';
}

// ---- Azure AI Translator (F0 tier) ----
async function azureTranslate(text, targetLanguage) {
  const url = `${TRANSLATOR_ENDPOINT.replace(/\/$/, '')}/translate?api-version=3.0&to=${encodeURIComponent(targetLanguage)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': TRANSLATOR_KEY,
      'Ocp-Apim-Subscription-Region': TRANSLATOR_REGION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ Text: text }]),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Azure Translator failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.[0]?.translations?.[0]?.text || '';
}

module.exports = { isConfigured, azureTranscribe, azureStructureNote, azureOcrImage, azureTranslate };
