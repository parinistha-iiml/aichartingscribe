// Real Vercel Blob storage (https://vercel.com/docs/vercel-blob).
// Used to persist the actual audio a doctor dictated, so past encounters
// can be played back later from Visit History — not just their
// transcripts. Before this, dictation audio was uploaded to Azure Speech
// for transcription and then discarded; nothing was ever saved, and
// dictationLog.audioUrl was a placeholder string (`mock://...`) that
// pointed at nothing.
//
// Vercel Blob now defaults to OIDC auth: connecting a store to a project
// auto-injects BLOB_STORE_ID + VERCEL_OIDC_TOKEN (rotated automatically
// per deployment), and the @vercel/blob SDK picks these up on its own —
// no token needs to be passed to `put()` at all. A static
// BLOB_READ_WRITE_TOKEN is no longer added by default, but if one is set
// (e.g. for local dev, or copied manually from the store's ".env.local"
// tab), we still pass it explicitly since that also works and is simpler
// to run locally without `vercel env pull`.
// If neither is present, isConfigured.blob() is false and the caller
// (server/index.js) keeps the old mock:// placeholder instead of silently
// pretending the audio was saved.

const { put } = require('@vercel/blob');

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_STORE_ID = process.env.BLOB_STORE_ID;

const isConfigured = {
  blob: () => !!(BLOB_TOKEN || BLOB_STORE_ID),
};

// Uploads one dictation take's audio and returns its real, publicly
// fetchable URL. Pathname is namespaced by encounter so recordings for
// the same patient/encounter sit together in the store.
async function uploadDictationAudio(encounterId, audioBuffer, mimetype) {
  if (!isConfigured.blob()) {
    throw new Error('Vercel Blob is not configured (no BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID/OIDC)');
  }
  const ext = mimetype && mimetype.includes('wav') ? 'wav' : 'audio';
  const pathname = `dictations/${encounterId}/${Date.now()}.${ext}`;
  const blob = await put(pathname, audioBuffer, {
    access: 'public',
    contentType: mimetype || 'audio/wav',
    // Only pass an explicit token when we have the static one — when
    // relying on OIDC (BLOB_STORE_ID + VERCEL_OIDC_TOKEN), the SDK
    // resolves auth from the environment on its own and passing
    // `token: undefined` here is fine too, but this is more explicit.
    ...(BLOB_TOKEN ? { token: BLOB_TOKEN } : {}),
  });
  return blob.url;
}

module.exports = { isConfigured, uploadDictationAudio };