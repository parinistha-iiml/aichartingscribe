import { useEffect, useState } from 'react';
import { api } from '../api';

// This step is "the discharge template" — picking WHICH hospital format
// this encounter uses, and reviewing/editing that template's own fields
// ("Name of Patient", "IP No", "Final Diagnosis"...) mapped from the raw
// transcript, alongside the raw transcript itself exactly as dictated.
// It does NOT generate the discharge document — that action (and the
// canonical structured-entity editor) lives on the next screen,
// Structured Note. This screen's job ends at: template + its fields +
// transcript, all reviewed and correct.
export default function DischargeFormat({ encounter, onUpdate, onNext, onBack, onError }) {
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState(encounter.structuredNote);

  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateId, setTemplateId] = useState(encounter.templateId || '');
  const [templateName, setTemplateName] = useState('');
  const [fields, setFields] = useState(encounter.templateFieldValues || []); // [{slug, label, value}]
  const [fieldsLoading, setFieldsLoading] = useState(false);

  useEffect(() => {
    setTemplatesLoading(true);
    api
      .getTemplates()
      .then(setTemplates)
      .catch((e) => onError(e.message))
      .finally(() => setTemplatesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canonical extraction from the transcript — runs once per encounter
  // (Text Analytics for Health), reused here and by every later screen via
  // encounter state rather than re-fetched.
  useEffect(() => {
    async function run() {
      setLoading(true);
      try {
        let currentNote = encounter.structuredNote;
        if (!currentNote) {
          const { structuredNote } = await api.structure(encounter.id, encounter.rawTranscript);
          currentNote = structuredNote;
          setNote(structuredNote);
          onUpdate({
            ...encounter,
            structuredNote,
            aiOriginal: { ...(encounter.aiOriginal || {}), structuredNote },
          });
        }
        if (templateId) await loadTemplateFields(templateId, currentNote);
      } catch (e) {
        onError(e.message);
      } finally {
        setLoading(false);
      }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter.id]);

  // Maps the extracted entities onto THIS template's own fields — "Name of
  // Patient", "IP No", "Final Diagnosis" — whatever the hospital's
  // document actually calls them.
  async function loadTemplateFields(id, currentNote) {
    if (!id) {
      setFields([]);
      setTemplateName('');
      return;
    }
    setFieldsLoading(true);
    try {
      const result = await api.getTemplateFields(encounter.id, id, currentNote || note);
      setTemplateName(result.templateName);
      setFields(result.fields);
    } catch (e) {
      onError(e.message);
    } finally {
      setFieldsLoading(false);
    }
  }

  function handleTemplateChange(newTemplateId) {
    setTemplateId(newTemplateId);
    loadTemplateFields(newTemplateId, note);
  }

  function updateFieldValue(slug, value) {
    setFields((prev) => prev.map((f) => (f.slug === slug ? { ...f, value } : f)));
  }

  function commitAndNext() {
    onUpdate({
      ...encounter,
      structuredNote: note,
      templateId: templateId || null,
      templateFieldValues: fields,
    });
    onNext();
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Structuring note from transcript…</div>;
  }

  return (
    <div className="max-w-6xl grid lg:grid-cols-[1fr_360px] gap-4 items-start">
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h2 className="font-medium text-sm">Discharge format</h2>
            <select
              className="border border-slate-300 rounded-md px-2 py-1 text-xs"
              value={templateId}
              disabled={templatesLoading}
              onChange={(e) => handleTemplateChange(e.target.value)}
            >
              <option value="">Generic format (no template)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {!templateId && (
            <p className="text-xs text-slate-400">
              No hospital template selected — using a generic discharge format. Upload one from
              "Discharge templates" in the header to review the hospital's own fields here instead.
            </p>
          )}
          {templateId && (
            <p className="text-xs text-slate-400">
              Showing <span className="font-medium text-slate-500">{templateName}</span>'s own fields — mapped from
              the transcript, editable before generating the document on the next step.
            </p>
          )}
        </div>

        {templateId && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
            <h2 className="font-medium text-sm">{templateName} — fields (editable)</h2>
            {fieldsLoading && <div className="text-sm text-slate-400">Mapping transcript to this template's fields…</div>}
            {!fieldsLoading &&
              fields.map((f) => (
                <div key={f.slug}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{f.label}</label>
                  <input
                    className={`w-full border rounded-md px-2.5 py-1.5 text-sm ${f.value ? 'border-slate-300' : 'border-amber-300 bg-amber-50'}`}
                    value={f.value}
                    placeholder={f.value ? '' : 'Not captured from dictation — fill in manually'}
                    onChange={(e) => updateFieldValue(f.slug, e.target.value)}
                  />
                </div>
              ))}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onBack} className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
            ← Back
          </button>
          <button
            disabled={fieldsLoading}
            onClick={commitAndNext}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Review structured note →
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] flex flex-col">
        <h2 className="font-medium mb-1 shrink-0">Raw transcript</h2>
        <p className="text-sm text-slate-500 whitespace-pre-wrap overflow-y-auto">
          {encounter.rawTranscript}
        </p>
      </div>
    </div>
  );
}
