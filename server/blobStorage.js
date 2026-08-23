// Real Vercel Blob storage (https://vercel.com/docs/storage/vercel-blob).
// Used to persist the actual audio a doctor dictated, so past encounters
// can be played back later from Visit History — not just their
// transcripts. Before this, dictation audio was uploaded to Azure Speech
// for transcription and then discarded; nothing was ever saved, and
// dictationLog.audioUrl was a placeholder string (`mock://...`) that
// pointed at nothing.
//
// Requires BLOB_READ_WRITE_TOKEN (from a Vercel Blob store — Storage tab
// in your Vercel project, or `vercel blob store create` via the Vercel
// CLI). If it's not set, isConfigured.blob() is false and the caller
// (server/index.js) keeps the old mock:// placeholder instead of silently
// pretending the audio was saved.

const { put } = require('@vercel/blob');

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

const isConfigured = {
  blob: () => !!BLOB_TOKEN,
};

// Uploads one dictation take's audio and returns its real, publicly
// fetchable URL. Pathname is namespaced by encounter so recordings for
// the same patient/encounter sit together in the store.
async function uploadDictationAudio(encounterId, audioBuffer, mimetype) {
  if (!BLOB_TOKEN) throw new Error('Vercel Blob is not configured (BLOB_READ_WRITE_TOKEN missing)');
  const ext = mimetype && mimetype.includes('wav') ? 'wav' : 'audio';
  const pathname = `dictations/${encounterId}/${Date.now()}.${ext}`;
  const blob = await put(pathname, audioBuffer, {
    access: 'public',
    contentType: mimetype || 'audio/wav',
    token: BLOB_TOKEN,
  });
  return blob.url;
}

module.exports = { isConfigured, uploadDictationAudio };
