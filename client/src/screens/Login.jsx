import { useState } from 'react';
import { api } from '../api';

const SPECIALTIES = [
  'General Medicine',
  'Internal Medicine',
  'Family Medicine',
  'Obstetrics and Gynaecology',
  'Pediatrics',
  'Cardiology',
  'Orthopedics',
  'Dermatology',
  'ENT (Otolaryngology)',
  'Ophthalmology',
  'Psychiatry',
  'Neurology',
  'Gastroenterology',
  'Pulmonology',
  'Nephrology',
  'Endocrinology',
  'Oncology',
  'Urology',
  'General Surgery',
  'Emergency Medicine',
  'Anesthesiology',
  'Radiology',
  'Dentistry',
  'Physiotherapy',
];

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [specialty, setSpecialty] = useState(SPECIALTIES[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const doctor =
        mode === 'login'
          ? await api.login(email.trim(), password)
          : await api.signup(name.trim(), email.trim(), password, specialty);
      onLogin(doctor);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
      <h1 className="text-lg font-semibold mb-1">{mode === 'login' ? 'Doctor sign in' : 'Create doctor account'}</h1>
      <p className="text-sm text-slate-500 mb-4">
        {mode === 'login'
          ? 'Sign in with your email and password.'
          : 'Your name, email, and password are stored in the hospital database.'}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === 'signup' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Full name</label>
            <input
              required
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dr. Anjali Rao"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
          <input
            required
            type="email"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@hospital.com"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Password</label>
          <input
            required
            type="password"
            minLength={mode === 'signup' ? 6 : undefined}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'At least 6 characters' : ''}
          />
        </div>

        {mode === 'signup' && (
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Specialty</label>
            <select
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            >
              {SPECIALTIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded px-2 py-1.5">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === 'login' ? 'signup' : 'login');
          setError('');
        }}
        className="w-full text-center text-xs text-indigo-600 hover:underline mt-3"
      >
        {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>

      {mode === 'login' && (
        <p className="text-[11px] text-slate-400 mt-4 border-t border-slate-100 pt-3">
        </p>
      )}
    </div>
  );
}
