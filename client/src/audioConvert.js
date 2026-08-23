// Browsers disagree on what MediaRecorder produces (Chrome: webm/opus,
// Safari: mp4/aac, Firefox: ogg/webm depending on version) — and Azure
// Speech's short-audio REST endpoint has a narrower supported-format list
// than "whatever the browser felt like recording." Rather than trying to
// track every browser's default and hoping Azure accepts it, decode
// whatever we got and re-encode it as 16kHz mono 16-bit PCM WAV — a format
// Azure's docs use in their own quickstart examples — so the format is
// guaranteed correct no matter which browser or upload produced the source
// audio.

export async function convertToWav16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }

  const targetSampleRate = 16000;
  const offlineCtx = new OfflineAudioContext(
    1, // mono output — multi-channel sources are auto-downmixed on connect
    Math.ceil(decoded.duration * targetSampleRate),
    targetSampleRate
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  const samples = rendered.getChannelData(0);

  return encodeWavPCM16(samples, targetSampleRate);
}

function encodeWavPCM16(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = 1 (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * blockAlign)
  view.setUint16(32, 2, true); // block align (channels * bytesPerSample)
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}
