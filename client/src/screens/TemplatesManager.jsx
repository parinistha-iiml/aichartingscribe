import { useEffect, useState } from 'react';
import { api } from '../api';

export default function TemplatesManager({ doctor, onBack }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrWarnings, setOcrWarnings] = useState([]);
  const [detectedCount, setDetectedCount] = useState(null);

  function load() {
    setLoading(true);
    api.getTemplates().then(setTemplates).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setOcrBusy(true);
    setError('');
    setOcrWarnings([]);
    setDetectedCount(null);
    try {
      const result = await api.ocrTemplate(file);
      setName(result.suggestedName);
      setText(result.templateText);
      setOcrWarnings(result.warnings || []);
      setDetectedCount(result.detectedFields?.length ?? 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setOcrBusy(false);
      e.target.value = '';
    }
  }

  async function handleUpload() {
    if (!name.trim() || !text.trim()) {
      setError('Both a name and the template text are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createTemplate(name.trim(), text, doctor.id);
      setName('');
      setText('');
      setOcrWarnings([]);
      setDetectedCount(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold mb-1">Discharge document templates</h1>
      <p className="text-sm text-slate-500 mb-4">
        Upload your hospital's existing discharge summary (PDF) — it's read and turned into a
        reusable format automatically. Every future encounter fills the same fields from its
        dictation, instead of anyone typing out a template by hand.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4 space-y-3">
        <h2 className="font-medium text-sm">Upload an existing document</h2>
        <label className="inline-block text-sm text-indigo-600 hover:underline cursor-pointer">
          {ocrBusy ? 'Reading document…' : 'Choose a PDF (or image) to read'}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleFileUpload} disabled={ocrBusy} />
        </label>
        <p className="text-xs text-slate-400">
          PDFs with a text layer are read directly. Scanned images use OCR.
        </p>

        {detectedCount !== null && (
          <div className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-2 py-1.5">
            Detected {detectedCount} field{detectedCount === 1 ? '' : 's'} and blanked patient-specific
            values below. This did not save anything yet.
          </div>
        )}
        {ocrWarnings.map((w, i) => (
          <div key={i} className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded px-2 py-1.5">
            ⚠️ {w}
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4 space-y-3">
        <h2 className="font-medium text-sm">Review before saving</h2>
        {error && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded px-2 py-1.5">{error}</div>}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Template name</label>
          <input
            className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm"
            placeholder="e.g. XYZ Health Network — OBG Discharge Format"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">
            Template text — check carefully for any remaining patient name, ID, phone number, or address
          </label>
          <textarea
            className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm font-mono min-h-56"
            placeholder="Upload a document above, or type/paste a template with {{placeholders}} directly."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button
          disabled={saving}
          onClick={handleUpload}
          className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save template'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <h2 className="font-medium text-sm mb-2">Existing templates</h2>
        {loading && <div className="text-sm text-slate-400">Loading…</div>}
        {!loading && templates.length === 0 && <div className="text-sm text-slate-400">None uploaded yet.</div>}
        <div className="space-y-2">
          {templates.map((t) => (
            <details key={t.id} className="border border-slate-100 rounded-md p-2.5">
              <summary className="text-sm font-medium cursor-pointer">{t.name}</summary>
              <pre className="text-xs text-slate-500 whitespace-pre-wrap mt-2">{t.templateText}</pre>
            </details>
          ))}
        </div>
      </div>

      <button onClick={onBack} className="mt-4 px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
        ← Back
      </button>
    </div>
  );
}
