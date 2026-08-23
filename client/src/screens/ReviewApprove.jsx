import { useState } from 'react';
import { api } from '../api';
import { downloadTextFile } from '../downloadFile';

function DiffRow({ label, before, after }) {
  const changed = (before ?? '') !== (after ?? '');
  return (
    <div className="border-b border-slate-100 last:border-0 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {changed ? (
          <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
            Edited
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">
            Unchanged
          </span>
        )}
      </div>
      {changed ? (
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          <div className="bg-red-50 border border-red-100 rounded p-2 whitespace-pre-wrap text-red-900">
            <div className="text-[10px] text-red-400 mb-1">AI-suggested</div>
            {before || '—'}
          </div>
          <div className="bg-green-50 border border-green-100 rounded p-2 whitespace-pre-wrap text-green-900">
            <div className="text-[10px] text-green-500 mb-1">Doctor-edited</div>
            {after || '—'}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-600 whitespace-pre-wrap bg-slate-50 rounded p-2 border border-slate-100">
          {after || '—'}
        </div>
      )}
    </div>
  );
}

// Single-stage approval — the dictating doctor reviews their own edits
// against the AI draft and approves directly. No separate checker role or
// pending_checker hold state; "approved" means the doctor signed off on
// it themselves.
export default function ReviewApprove({ encounter, patient, doctor, onUpdate, onBack, onError }) {
  const [busy, setBusy] = useState(false);
  const ai = encounter.aiOriginal || {};

  const diffBlock = (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm divide-y divide-slate-100 mb-4">
      <DiffRow
        label="Structured note"
        before={ai.structuredNote ? JSON.stringify(ai.structuredNote, null, 2) : ''}
        after={JSON.stringify(encounter.structuredNote, null, 2)}
      />
      <DiffRow label="Discharge summary (clinical)" before={ai.dischargeSummary} after={encounter.dischargeSummary} />
      <DiffRow label="Patient summary (plain-language)" before={ai.patientSummary} after={encounter.patientSummary} />
      {encounter.translatedSummary && (
        <DiffRow
          label={`Translated summary (${encounter.targetLanguage})`}
          before={encounter.translatedSummary}
          after={encounter.translatedSummary}
        />
      )}
    </div>
  );

  async function handleApprove() {
    setBusy(true);
    try {
      const updated = await api.approve(encounter.id, {
        doctorId: doctor.id,
        structuredNote: encounter.structuredNote,
        dischargeSummary: encounter.dischargeSummary,
        patientSummary: encounter.patientSummary,
        translatedSummary: encounter.translatedSummary,
      });
      onUpdate(updated);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleDownload() {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`${patient.name.replace(/\s+/g, '-')}-discharge-summary-${date}.txt`, encounter.dischargeSummary);
  }

  // ---- Approved: end of the journey ----
  if (encounter.status === 'approved') {
    return (
      <div className="max-w-2xl">
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md px-3 py-2 text-sm mb-4">
          Approved by {doctor.name} and sent.
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4">
          <h2 className="font-medium text-sm mb-2">Discharge document</h2>
          <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono bg-slate-50 border border-slate-100 rounded p-3 mb-3 max-h-80 overflow-y-auto">
            {encounter.dischargeSummary}
          </pre>
          <button
            onClick={handleDownload}
            className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700"
          >
            ⬇ Download discharge slip
          </button>
        </div>
        <button onClick={onBack} className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
          ← Back
        </button>
      </div>
    );
  }

  // ---- Draft: reviewing before approval ----
  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold mb-1">Review & approve</h1>
      <p className="text-sm text-slate-500 mb-4">
        {patient.name} — review your edits against the AI draft, then approve to finalize this encounter.
      </p>
      {diffBlock}
      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
          ← Back
        </button>
        <button
          disabled={busy}
          onClick={handleApprove}
          className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Approving…' : 'Approve & Send'}
        </button>
      </div>
    </div>
  );
}
