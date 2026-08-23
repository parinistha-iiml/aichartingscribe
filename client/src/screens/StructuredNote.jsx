import { useState } from 'react';
import { api } from '../api';

// This step generates the actual discharge document — using the
// structured note extracted earlier and the template field values already
// reviewed on the Discharge Format step — and lets the doctor review it
// full-screen, either editing the raw text or previewing it as it will
// print. There's no separate structured-note editor here anymore: the
// entities extracted upstream (symptoms/meds/diagnosis/ICD-10) carry
// through untouched to the patient summary step; this screen is entirely
// about the discharge document itself.
export default function StructuredNote({ encounter, onUpdate, onNext, onBack, onError }) {
  const [discharge, setDischarge] = useState(encounter.dischargeSummary || '');
  const [dischargeGenerated, setDischargeGenerated] = useState(!!encounter.dischargeSummary);
  const [generating, setGenerating] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [mode, setMode] = useState('preview'); // 'preview' | 'edit'

  async function handleGenerateDischarge() {
    setGenerating(true);
    try {
      const note = encounter.structuredNote;
      let dischargeSummary;
      if (encounter.templateId) {
        const templateFieldValues = Object.fromEntries((encounter.templateFieldValues || []).map((f) => [f.slug, f.value]));
        ({ dischargeSummary } = await api.discharge(encounter.id, note, encounter.templateId, templateFieldValues));
      } else {
        ({ dischargeSummary } = await api.discharge(encounter.id, note, undefined, undefined));
      }
      setDischarge(dischargeSummary);
      setDischargeGenerated(true);
      setMode('preview');
    } catch (e) {
      onError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function commitAndNext() {
    onUpdate({
      ...encounter,
      dischargeSummary: discharge,
      aiOriginal: { ...(encounter.aiOriginal || {}), dischargeSummary: discharge },
    });
    onNext();
  }

  const modeToggle = (
    <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs">
      <button
        onClick={() => setMode('preview')}
        className={`px-2.5 py-1 ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
      >
        Preview
      </button>
      <button
        onClick={() => setMode('edit')}
        className={`px-2.5 py-1 border-l border-slate-300 ${mode === 'edit' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
      >
        Edit
      </button>
    </div>
  );

  const documentBody =
    mode === 'preview' ? (
      <div className="flex-1 overflow-y-auto bg-slate-50 rounded-md border border-slate-200 p-6">
        <div className="max-w-3xl mx-auto bg-white shadow-sm border border-slate-200 rounded-md px-10 py-10 font-serif text-[15px] leading-relaxed whitespace-pre-wrap text-slate-800">
          {discharge}
        </div>
      </div>
    ) : (
      <textarea
        className="flex-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono resize-none"
        value={discharge}
        onChange={(e) => setDischarge(e.target.value)}
      />
    );

  // ---- Full screen overlay ----
  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <h2 className="font-medium text-sm">Discharge summary</h2>
          <div className="flex items-center gap-2">
            {modeToggle}
            <button
              disabled={generating}
              onClick={handleGenerateDischarge}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Regenerate'}
            </button>
            <button
              onClick={() => setFullScreen(false)}
              className="px-3 py-1.5 rounded-md border border-slate-300 text-xs hover:bg-slate-100"
            >
              ✕ Close full screen
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col p-4">{documentBody}</div>
      </div>
    );
  }

  // ---- Normal (windowed) view ----
  return (
    <div className="max-w-6xl grid lg:grid-cols-[1fr_360px] gap-4 items-start">
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col" style={{ minHeight: '32rem' }}>
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-medium text-sm">Discharge summary</h2>
            <div className="flex items-center gap-2">
              {dischargeGenerated && modeToggle}
              <button
                disabled={generating}
                onClick={handleGenerateDischarge}
                className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700 disabled:opacity-50"
              >
                {generating ? 'Generating…' : dischargeGenerated ? 'Regenerate' : 'Generate discharge summary'}
              </button>
              {dischargeGenerated && (
                <button
                  onClick={() => setFullScreen(true)}
                  className="px-3 py-1.5 rounded-md border border-slate-300 text-xs hover:bg-slate-100"
                >
                  ⛶ Full screen
                </button>
              )}
            </div>
          </div>
          {!dischargeGenerated && !generating && (
            <p className="text-xs text-slate-400">
              {encounter.templateId
                ? 'Generate the document from the template fields you reviewed on the previous step.'
                : 'Generate a generic discharge summary from the structured note extracted from this encounter.'}
            </p>
          )}
          {(dischargeGenerated || generating) && <div className="flex-1 flex flex-col min-h-0">{documentBody}</div>}
        </div>

        <div className="flex gap-2">
          <button onClick={onBack} className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
            ← Back
          </button>
          <button
            disabled={!dischargeGenerated}
            onClick={commitAndNext}
            className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            Generate patient summary →
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