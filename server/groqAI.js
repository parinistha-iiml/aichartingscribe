 // Real Groq API call (https://api.groq.com) — Groq's free tier requires
// only a free account and an API key, no payment method. Used for exactly
// one job: mapping a doctor's raw dictation onto a hospital discharge
// template's own free-text fields ("Investigations", "Diet", "Physical
// activity", "Miscellaneous", "Course in hospital"...) — the fields that
// have no fixed clinical concept and previously relied on keyword/regex
// matching against the transcript (see searchTranscriptByLabel in
// templateData.js, still used as the fallback when Groq isn't configured).
//
// This is deliberately NOT used for fields we already have exact
// structured data for (patient name, diagnosis, ICD-10, medications,
// symptoms) — those come straight from Text Analytics for Health and the
// patient/doctor records, so there's no reason to let a generative model
// re-derive (and possibly hallucinate) something we already know for a
// fact. See resolveDeterministicFieldValue in templateData.js.
//
// No mocking: if GROQ_API_KEY isn't set, isConfigured.groq() is false and
// the caller (server/index.js) uses the old regex-based fallback instead —
// same pattern as every other integration in this app (Azure Speech,
// Text Analytics for Health, etc.) when its own key is missing.

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// llama-3.3-70b-versatile (and llama-3.1-8b-instant) were deprecated by
// Groq — openai/gpt-oss-120b is their current recommended general-purpose
// replacement. Override via GROQ_MODEL if you want a different one (e.g.
// the smaller/faster openai/gpt-oss-20b).
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const isConfigured = {
  groq: () => !!GROQ_API_KEY,
};

const SYSTEM_PROMPT = `You fill fields on a hospital discharge form using ONLY what a doctor actually said in their dictated transcript.

Rules:
- Use only information explicitly present in the transcript. Never invent, infer, guess, or add clinical facts that weren't said.
- If the transcript says nothing relevant to a field, its value MUST be an empty string "" — do not pad it with a generic sentence.
- Lightly clean up filler/disfluencies but do not paraphrase into new claims, and do not add clinical interpretation beyond what was dictated.
- Keep each value concise — usually one short sentence or phrase per field, not a copy of unrelated parts of the transcript.
- Respond with ONLY a single JSON object mapping each given field slug to its string value. No prose, no markdown, no extra keys.`;

function buildUserPrompt(fields, rawTranscript) {
  const fieldList = fields.map((f) => `- slug: "${f.slug}"  label: "${f.label}"`).join('\n');
  return `Transcript:\n"""\n${rawTranscript}\n"""\n\nFields to fill from the transcript above:\n${fieldList}\n\nReturn a JSON object like {"<slug>": "<value or empty string>", ...} with exactly these slugs as keys.`;
}

// fields: [{slug, label}] — only the fields with no fixed clinical concept
// (the caller filters those out before calling this). Returns { slug: value }.
async function groqMapTemplateFields(fields, rawTranscript) {
  if (!fields.length) return {};
  if (!GROQ_API_KEY) throw new Error('Groq API key not configured');

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(fields, rawTranscript || '') },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq API failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq API returned no content');

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Groq API returned unparseable JSON: ${e.message}`);
  }

  // Defensive: only keep string values for slugs we actually asked about —
  // never trust the model to have stuck to exactly the requested shape.
  const result = {};
  for (const f of fields) {
    const value = parsed[f.slug];
    result[f.slug] = typeof value === 'string' ? value.trim() : '';
  }
  return result;
}

module.exports = { isConfigured, groqMapTemplateFields };