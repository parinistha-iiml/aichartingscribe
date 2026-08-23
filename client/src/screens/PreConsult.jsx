import { useEffect, useState } from 'react';
import { api } from '../api';

export default function PreConsult({ patient, onNext, onBack }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPreconsult(patient.id).then(setBrief).finally(() => setLoading(false));
  }, [patient.id]);

  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-semibold mb-1">Pre-consult brief</h1>
      <p className="text-sm text-slate-500 mb-4">
        {patient.name}, age {patient.age} —{' '}
        {brief?.source === 'history' ? 'auto-generated from their last approved visit.' : 'auto-generated summary of prior visit history.'}
      </p>
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4">
        {loading && <div className="text-sm text-slate-400">Loading…</div>}
        {!loading && brief && (
          <ol className="list-decimal list-inside space-y-2 text-sm text-slate-700">
            {brief.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        )}
        {!loading && brief?.source === 'history' && (
          <div className="mt-3 text-xs text-slate-400">
            Based on their visit on {new Date(brief.lastVisitDate).toLocaleDateString()}.
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onBack} className="px-3 py-2 rounded-md border border-slate-300 text-sm hover:bg-slate-100">
          Back to queue
        </button>
        <button
          onClick={onNext}
          className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700"
        >
          Begin dictation →
        </button>
      </div>
    </div>
  );
}
