import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { convertToWav16kMono } from '../audioConvert';

export default function Dictation({ encounter, doctor, onContinue, onError }) {
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    api.getDictationLog(encounter.id).then(setLog).finally(() => setLoadingLog(false));
  }, [encounter.id]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        // Use the format the browser actually reports, not an assumed one —
        // Safari records audio/mp4, Chrome/Firefox typically record
        // audio/webm. This gets converted to WAV before upload either way.
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (e) {
      onError('Microphone access denied or unavailable. Try uploading an audio file instead.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) {
      setAudioBlob(file);
      setAudioUrl(URL.createObjectURL(file));
    }
  }

  async function handleTranscribe() {
    setBusy(true);
    try {
      const formData = new FormData();
      if (audioBlob) {
        // Convert whatever format we have (webm/opus, mp4/aac, whatever the
        // browser or an uploaded file used) into 16kHz mono WAV — the
        // format Azure Speech's REST endpoint reliably accepts, regardless
        // of source browser.
        const wavBlob = await convertToWav16kMono(audioBlob);
        formData.append('audio', wavBlob, 'dictation.wav');
      }
      formData.append('doctorId', doctor.id);
      const { dictationLog } = await api.transcribe(encounter.id, formData);
      setLog(dictationLog);
      setAudioBlob(null);
      setAudioUrl(null);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-lg font-semibold mb-1">Dictation</h1>
      <p className="text-sm text-slate-500 mb-4">
        Record via microphone or upload an audio file. Every take is logged below and stays
        reviewable — dictate again any time to add an addendum before structuring the note.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          {!recording ? (
            <button
              onClick={startRecording}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-white" /> Record
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-slate-800 text-white text-sm animate-pulse"
            >
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Stop recording
            </button>
          )}
          <span className="text-xs text-slate-400">or</span>
          <label className="text-sm text-indigo-600 hover:underline cursor-pointer">
            Upload audio file
            <input type="file" accept="audio/*" className="hidden" onChange={handleFileChange} />
          </label>
        </div>

        {audioUrl && (
          <div>
            <audio controls src={audioUrl} className="w-full" />
          </div>
        )}

        <button
          disabled={!audioBlob || busy}
          onClick={handleTranscribe}
          className="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Transcribing…' : log.length ? 'Transcribe this take →' : 'Transcribe →'}
        </button>
        {!audioBlob && (
          <button
            disabled={busy}
            onClick={handleTranscribe}
            className="w-full border border-slate-300 rounded-md py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
          >
            {busy ? 'Transcribing…' : 'No mic handy — use exsiting transcript for this take'}
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm mb-4">
        <h2 className="font-medium mb-2 text-sm">Dictation log ({log.length} take{log.length === 1 ? '' : 's'})</h2>
        {loadingLog && <div className="text-sm text-slate-400">Loading…</div>}
        {!loadingLog && log.length === 0 && (
          <div className="text-sm text-slate-400">No dictation recorded yet.</div>
        )}
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {log.map((entry, i) => (
            <div key={entry.id} className="border border-slate-100 rounded-md p-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500">Take {i + 1}</span>
                <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleTimeString()}</span>
              </div>
              <p className="text-xs text-slate-600 whitespace-pre-wrap">{entry.transcript}</p>
            </div>
          ))}
        </div>
      </div>

      <button
        disabled={log.length === 0}
        onClick={onContinue}
        className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
      >
        Continue to structuring →
      </button>
    </div>
  );
}
