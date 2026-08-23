import { useEffect, useState } from 'react';
import { api } from '../api';
import { downloadTextFile } from '../downloadFile';
import AuditLogModal from './AuditLogModal.jsx';

export default function PatientHistory({ patient, onBack, onNewEncounter }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auditModalFor, setAuditModalFor] = useState(null); // encounter object or null

  useEffect(() => {
    api.getPatientHistory(patient.id).then(setData).finally(() => setLoading(false));
  }, [patient.id]);

  const approved = (data?.encounters || []).filter((e) => e.status === 'approved');

  function handleDownload(e) {
    const date = new Date(e.createdAt).toISOString().slice(0, 10);
    downloadTextFile(`${patient.name.replace(/\s+/g, '-')}-discharge-summary-${date}.txt`, e.dischargeSummary);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-semibold mb-1">Visit history — {patient.name}</h1>
      <p className="text-sm text-slate-500 mb-4">
        Age {patient.age}. Past approved encounters, for reference when {patient.name.split(' ')[0]} comes in for a follow-up.
      </p>

      {loading && <div className="text-sm text-slate-400">Loading…</div>}

      {!loading && approved.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm text-sm text-slate-400 mb-4">
          Patient history on file.
        </div>
      )}

      <div className="space-y-3 mb-4">
        {approved.map((e) => (
          <div key={e.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="text-sm font-medium">{new Date(e.createdAt).toLocaleDateString()}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Seen by {e.doctorName}</span>
                <button
                  onClick={() => setAuditModalFor(e)}
                  className="text-xs px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                >
                  Audit log
                </button>
              </div>
            </div>

            <div className="text-sm text-slate-700 mb-3">
              <span className="font-medium">Diagnosis: </span>
              {e.diagnosis || '—'}
              {e.meds?.length ? <span className="text-slate-400"> · Meds: {e.meds.join(', ')}</span> : null}
            </div>

            <details className="text-xs mb-2">
              <summary className="cursor-pointer text-indigo-600">Discharge document</summary>
              <div className="mt-2 bg-slate-50 border border-slate-100 rounded p-3">
                <pre className="text-slate-600 whitespace-pre-wrap font-mono text-xs mb-2">
                  {e.dischargeSummary || 'Not recorded.'}
                </pre>
                {e.dischargeSummary && (
                  <button
                    onClick={() => handleDownload(e)}
                    className="text-xs px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                  >
                    ⬇ Download discharge slip
                  </button>
                )}
              </div>
            </details>

            <details className="text-xs mb-2">
              <summary className="cursor-pointer text-indigo-600">Patient-facing summary given at that visit</summary>
              <p className="text-slate-500 whitespace-pre-wrap mt-2 bg-slate-50 border border-slate-100 rounded p-2">
                {e.patientSummary || 'Not recorded.'}
              </p>
              {e.translatedSummary && (
                <p className="text-slate-500 whitespace-pre-wrap mt-2 bg-slate-50 border border-slate-100 rounded p-2">
                  {e.translatedSummary}
                </p>
              )}
            </details>

            <details className="text-xs">
              <summary className="cursor-pointer text-indigo-600">
                Dictation recordings ({e.recordings?.length || 0})
              </summary>
              <div className="mt-2 space-y-2">
                {(!e.recordings || e.recordings.length === 0) && (
                  <p className="text-slate-400">No dictation takes recorded for this encounter.</p>
                )}
                {e.recordings?.map((r) => (
                  <div key={r.id} className="bg-slate-50 border border-slate-100 rounded p-2">
                    <div className="text-slate-400 mb-1">{new Date(r.createdAt).toLocaleString()}</div>
                    {r.audioUrl ? (
                      <audio controls src={r.audioUrl} className="w-full h-8" />
                    ) : (
                      <p className="text-slate-400">
                        Recording not available — audio storage wasn't configured when this was dictated.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
          ← Back to queue
        </button>
        <button onClick={onNewEncounter} className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700">
          Start new encounter →
        </button>
      </div>

      {auditModalFor && <AuditLogModal auditLog={auditModalFor.auditLog} onClose={() => setAuditModalFor(null)} />}
    </div>
  );
}
