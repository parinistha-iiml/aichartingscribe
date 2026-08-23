import Modal from './Modal';

// Same table that used to live on its own screen at the end of the
// journey — now opened per-encounter from Visit History instead, since an
// audit trail belongs with the encounter it describes, not as a fixed
// final step every visit has to pass through.
export default function AuditLogModal({ auditLog, onClose }) {
  return (
    <Modal title="Audit log" onClose={onClose} wide>
      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Timestamp</th>
              <th className="text-left px-3 py-2">Doctor</th>
              <th className="text-left px-3 py-2">Field</th>
              <th className="text-left px-3 py-2">Change</th>
            </tr>
          </thead>
          <tbody>
            {(!auditLog || auditLog.length === 0) && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                  No changes recorded.
                </td>
              </tr>
            )}
            {(auditLog || []).map((entry, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                  {new Date(entry.timestamp).toLocaleString()}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{entry.doctor}</td>
                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{entry.field}</td>
                <td className="px-3 py-2 text-xs text-slate-500 max-w-xs truncate" title={entry.after}>
                  {entry.field === 'status' ? `${entry.before} → ${entry.after}` : 'edited'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
