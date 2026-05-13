function formatUrl(url) {
  if (!url) return '';
  try {
    const p = new URL(url);
    return p.origin + p.pathname.replace(/\/$/, '');
  } catch { return url; }
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeTimestamp(iso) {
  const ts = iso || new Date().toISOString();
  return ts.replace(/:/g, '-').replace(/\..+/, '');
}

function pluralWord(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
