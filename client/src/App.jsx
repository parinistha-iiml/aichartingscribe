import { useState, useEffect, useCallback } from 'react';
import { api } from './api';

import Login from './screens/Login';
import PatientQueue from './screens/PatientQueue';
import PreConsult from './screens/PreConsult';
import Dictation from './screens/Dictation';
import DischargeFormat from './screens/DischargeFormat';
import DischargeSummary from './screens/DischargeSummary';
import PatientSummary from './screens/PatientSummary';
import ReviewApprove from './screens/ReviewApprove';
import PatientHistory from './screens/PatientHistory';
import TemplatesManager from './screens/TemplatesManager';

const STEPS = [
  { key: 'queue', label: 'Queue' },
  { key: 'preconsult', label: 'Pre-Consult' },
  { key: 'dictation', label: 'Dictation' },
  { key: 'dischargeFormat', label: 'Discharge Format' },
  { key: 'structured', label: 'Discharge Summary' },
  { key: 'summary', label: 'Patient Summary' },
  { key: 'review', label: 'Review & Approve' },
];

export default function App() {
  const [doctor, setDoctor] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [screen, setScreen] = useState('login');
  const [patients, setPatients] = useState([]);
  const [activePatient, setActivePatient] = useState(null);
  const [encounter, setEncounter] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (doctor) {
      api.getPatients().then(setPatients).catch((e) => setError(e.message));
      api.getDoctors().then(setDoctors).catch((e) => setError(e.message));
    }
  }, [doctor]);

  const refreshEncounter = useCallback(async (id) => {
    const e = await api.getEncounter(id);
    setEncounter(e);
    return e;
  }, []);

  const refreshPatients = useCallback(() => {
    api.getPatients().then(setPatients).catch((e) => setError(e.message));
  }, []);

  const handleLogin = (doc) => {
    setDoctor(doc);
    setScreen('queue');
  };

  const handleNewEncounter = async (patient) => {
    setError('');
    setActivePatient(patient);
    const e = await api.createEncounter(patient.id, doctor.id);
    setEncounter(e);
    setScreen('preconsult');
  };

  const handleViewHistory = (patient) => {
    setError('');
    setActivePatient(patient);
    setEncounter(null);
    setScreen('history');
  };

  const logout = () => {
    setDoctor(null);
    setActivePatient(null);
    setEncounter(null);
    setScreen('login');
  };

  const inStepFlow = STEPS.some((s) => s.key === screen) && screen !== 'queue';
  const stepIndex = STEPS.findIndex((s) => s.key === screen);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
              AC
            </div>
            <div>
              <div className="font-semibold leading-none">AI Charting Scribe</div>
              <div className="text-xs text-slate-400 leading-none mt-1">AI medical scribe and discharge notes generator</div>
            </div>
          </div>
          {doctor && (
            <div className="flex items-center gap-3 text-sm">
              <button
                onClick={() => setScreen('templates')}
                className={`px-2.5 py-1.5 rounded-md border text-xs ${screen === 'templates' ? 'border-indigo-600 text-indigo-600' : 'border-slate-300 text-slate-500 hover:bg-slate-100'}`}
              >
                Discharge templates
              </button>
              <span className="text-slate-500">
                {doctor.name} · <span className="text-slate-400">{doctor.specialty}</span>
              </span>
              <button onClick={logout} className="px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100">
                Log out
              </button>
            </div>
          )}
        </div>
        {doctor && inStepFlow && (
          <div className="max-w-5xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto text-xs">
            {STEPS.slice(1).map((s, i) => {
              const idx = STEPS.findIndex((x) => x.key === s.key);
              const done = idx < stepIndex;
              const current = idx === stepIndex;
              return (
                <button
                  key={s.key}
                  disabled={!encounter || idx > stepIndex}
                  onClick={() => encounter && idx <= stepIndex && setScreen(s.key)}
                  className={`px-2.5 py-1 rounded-full whitespace-nowrap border transition
                    ${current ? 'bg-indigo-600 text-white border-indigo-600' : done ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-400 border-slate-200'}`}
                >
                  {i + 1}. {s.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 text-sm bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {screen === 'login' && <Login onLogin={handleLogin} />}

        {screen === 'queue' && doctor && (
          <PatientQueue
            patients={patients}
            onSelect={handleNewEncounter}
            onViewHistory={handleViewHistory}
            onPatientCreated={refreshPatients}
          />
        )}

        {screen === 'history' && activePatient && (
          <PatientHistory
            patient={activePatient}
            onBack={() => setScreen('queue')}
            onNewEncounter={() => handleNewEncounter(activePatient)}
          />
        )}

        {screen === 'templates' && doctor && (
          <TemplatesManager doctor={doctor} onBack={() => setScreen(encounter ? 'structured' : 'queue')} />
        )}

        {screen === 'preconsult' && encounter && activePatient && (
          <PreConsult
            patient={activePatient}
            onNext={() => setScreen('dictation')}
            onBack={() => setScreen('queue')}
          />
        )}

        {screen === 'dictation' && encounter && doctor && (
          <Dictation
            encounter={encounter}
            doctor={doctor}
            onContinue={async () => {
              await refreshEncounter(encounter.id);
              setScreen('dischargeFormat');
            }}
            onError={setError}
          />
        )}

        {screen === 'dischargeFormat' && encounter && (
          <DischargeFormat
            encounter={encounter}
            onUpdate={(e) => setEncounter(e)}
            onNext={() => setScreen('structured')}
            onBack={() => setScreen('dictation')}
            onError={setError}
          />
        )}

        {screen === 'structured' && encounter && (
          <DischargeSummary
            encounter={encounter}
            onUpdate={(e) => setEncounter(e)}
            onNext={() => setScreen('summary')}
            onBack={() => setScreen('dischargeFormat')}
            onError={setError}
          />
        )}

        {screen === 'summary' && encounter && (
          <PatientSummary
            encounter={encounter}
            onUpdate={(e) => setEncounter(e)}
            onNext={() => setScreen('review')}
            onBack={() => setScreen('structured')}
            onError={setError}
          />
        )}

        {screen === 'review' && encounter && activePatient && (
          <ReviewApprove
            encounter={encounter}
            patient={activePatient}
            doctor={doctor}
            onUpdate={(e) => setEncounter(e)}
            onBack={() => setScreen('summary')}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}