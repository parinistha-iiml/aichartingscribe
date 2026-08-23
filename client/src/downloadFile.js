// Triggers a real browser download of plain text — used for the
// downloadable discharge slip. No server call needed: this builds an
// in-memory Blob and clicks a throwaway <a download> link, which is how
// browsers save files client-side.
export function downloadTextFile(filename, content) {
  const blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
