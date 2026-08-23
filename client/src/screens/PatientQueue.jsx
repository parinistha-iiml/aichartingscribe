import { useState } from 'react';
import { api } from '../api';

export default function PatientQueue({ patients, onSelect, onViewHistory, onPatientCreated }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd() {
    if (!name.trim() || !age) {
      setError('Name and age are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createPatient(name.trim(), Number(age), notes.trim());
      setName('');
      setAge('');
      setNotes('');
      setShowAdd(false);
      onPatientCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold">Patient queue</h1>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100"
        >
          {showAdd ? 'Cancel' : '+ Add patient'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4 space-y-2">
          {error && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded px-2 py-1.5">{error}</div>}
          <div className="grid sm:grid-cols-2 gap-2">
            <input
              className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm"
              placeholder="Patient name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type="number"
              min={0}
              className="border border-slate-300 rounded-md px-2.5 py-1.5 text-sm"
              placeholder="Age"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </div>
          <textarea
            className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-sm"
            rows={2}
            placeholder="Prior visit summary / notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            disabled={saving}
            onClick={handleAdd}
            className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save patient'}
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {patients.map((p) => (
          <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <div className="font-medium">{p.name}</div>
              <span className="text-xs text-slate-400">Age {p.age}</span>
            </div>
            <p className="text-sm text-slate-500 flex-1 mb-3 line-clamp-3">{p.priorVisitSummary}</p>
            <div className="flex gap-2">
              <button
                onClick={() => onSelect(p)}
                className="bg-indigo-600 text-white text-sm rounded-md px-3 py-1.5 hover:bg-indigo-700"
              >
                New Encounter
              </button>
              <button
                onClick={() => onViewHistory(p)}
                className="border border-slate-300 text-slate-600 text-sm rounded-md px-3 py-1.5 hover:bg-slate-100"
              >
                History
              </button>
            </div>
          </div>
        ))}
        {patients.length === 0 && <div className="text-sm text-slate-400">Loading patients…</div>}
      </div>
    </div>
  );
}
