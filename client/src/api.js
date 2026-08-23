const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  signup: (name, email, password, specialty) =>
    req('/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password, specialty }) }),
  login: (email, password) => req('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  getDoctors: () => req('/doctors'),
  getPatients: () => req('/patients'),
  getPatient: (id) => req(`/patients/${id}`),
  createPatient: (name, age, priorVisitSummary) =>
    req('/patients', { method: 'POST', body: JSON.stringify({ name, age, priorVisitSummary }) }),
  getPreconsult: (patientId) => req(`/patients/${patientId}/preconsult`),
  getPatientHistory: (patientId) => req(`/patients/${patientId}/history`),

  getTemplates: () => req('/templates'),
  createTemplate: (name, templateText, doctorId) =>
    req('/templates', { method: 'POST', body: JSON.stringify({ name, templateText, doctorId }) }),
  getTemplateFields: (encounterId, templateId, structuredNote) =>
    req(`/encounter/${encounterId}/template-fields`, { method: 'POST', body: JSON.stringify({ templateId, structuredNote }) }),
  ocrTemplate: (file) => {
    const formData = new FormData();
    formData.append('document', file);
    return req('/templates/from-document', { method: 'POST', body: formData });
  },

  createEncounter: (patientId, doctorId) =>
    req('/encounter', { method: 'POST', body: JSON.stringify({ patientId, doctorId }) }),
  getEncounter: (id) => req(`/encounter/${id}`),
  getDictationLog: (id) => req(`/encounter/${id}/dictation-log`),
  transcribe: (id, formData) => req(`/encounter/${id}/transcribe`, { method: 'POST', body: formData }),
  structure: (id, rawTranscript) =>
    req(`/encounter/${id}/structure`, { method: 'POST', body: JSON.stringify({ rawTranscript }) }),
  discharge: (id, structuredNote, templateId, templateFieldValues) =>
    req(`/encounter/${id}/discharge`, { method: 'POST', body: JSON.stringify({ structuredNote, templateId, templateFieldValues }) }),
  patientSummary: (id, structuredNote) =>
    req(`/encounter/${id}/patient-summary`, { method: 'POST', body: JSON.stringify({ structuredNote }) }),
  translate: (id, patientSummary, targetLanguage) =>
    req(`/encounter/${id}/translate`, { method: 'POST', body: JSON.stringify({ patientSummary, targetLanguage }) }),

  approve: (id, payload) => req(`/encounter/${id}/approve`, { method: 'PUT', body: JSON.stringify(payload) }),

  auditLog: (id) => req(`/encounter/${id}/audit-log`),
};
