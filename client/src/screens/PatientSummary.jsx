import { useEffect, useState } from 'react';
import { api } from '../api';

const LANGUAGES = [
  { code: '', label: 'English (no translation)' },
  { code: 'hi', label: 'Hindi' },
  { code: 'mr', label: 'Marathi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'bn', label: 'Bengali' },
];

export default function PatientSummary({ encounter, onUpdate, onNext, onBack, onError }) {
  const [loading, setLoading] = useState(true);
  const [patientSummary, setPatientSummary] = useState(encounter.patientSummary);
  const [language, setLanguage] = useState(encounter.targetLanguage || '');
  const [translated, setTranslated] = useState(encounter.translatedSummary || '');
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    async function run() {
      setLoading(true);
      try {
        const { patientSummary } = await api.patientSummary(encounter.id, encounter.structuredNote);
        setPatientSummary(patientSummary);
        onUpdate({
          ...encounter,
          patientSummary,
          aiOriginal: { ...(encounter.aiOriginal || {}), patientSummary },
        });
      } catch (e) {
        onError(e.message);
      } finally {
        setLoading(false);
      }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounter.id]);

  async function handleTranslate(code) {
    setLanguage(code);
    if (!code) {
      setTranslated('');
      return;
    }
    setTranslating(true);
    try {
      // Translation runs on the already-simplified plain-language text, not the raw clinical note.
      const { translatedSummary } = await api.translate(encounter.id, patientSummary, code);
      setTranslated(translatedSummary);
    } catch (e) {
      onError(e.message);
    } finally {
      setTranslating(false);
    }
  }

  function commitAndNext() {
    onUpdate({ ...encounter, patientSummary, translatedSummary: translated, targetLanguage: language || null });
    onNext();
  }

  if (loading) {
    return <div className="text-sm text-slate-500">Generating plain-language patient summary…</div>;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h2 className="font-medium mb-1">Clinical discharge summary</h2>
          <p className="text-sm text-slate-500 whitespace-pre-wrap max-h-64 overflow-y-auto">
            {encounter.dischargeSummary}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h2 className="font-medium mb-1">Patient-facing plain-language summary (editable)</h2>
          <textarea
            className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm min-h-56"
            value={patientSummary}
            onChange={(e) => setPatientSummary(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium">Translate for patient delivery</h2>
          <select
            className="border border-slate-300 rounded-md px-2 py-1 text-sm"
            value={language}
            onChange={(e) => handleTranslate(e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-slate-400 mb-2">
          Translation runs on the plain-language text above (after simplification), not the raw
          clinical note.
        </p>
        {translating && <div className="text-sm text-slate-400">Translating…</div>}
        {!translating && translated && (
          <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-md p-3 border border-slate-200">
            {translated}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
          ← Back
        </button>
        <button onClick={commitAndNext} className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700">
          Review & approve →
        </button>
      </div>
    </div>
  );
}
