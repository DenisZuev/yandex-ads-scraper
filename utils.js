function decodePunycodeUrl(url) {
  if (!url || !url.includes('xn--')) return url;
  try {
    const p = new URL(url);
    const decoded = toUnicode(p.hostname);
    if (decoded === p.hostname) return url;
    return p.protocol + '//' + decoded + p.pathname + p.search + p.hash;
  } catch { return url; }
}

function formatUrl(url) {
  if (!url) return '';
  try {
    const p = new URL(url);
    const display = p.origin + p.pathname.replace(/\/$/, '');
    return decodePunycodeUrl(display);
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

function parseUtmParams(url) {
  if (!url) return null;
  try {
    const params = new URL(url).searchParams;
    const utm = {};
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    for (const key of utmKeys) {
      const val = params.get(key);
      if (val) utm[key] = val;
    }
    return Object.keys(utm).length > 0 ? utm : null;
  } catch {
    return null;
  }
}

function escapeCSV(value) {
  if (value == null) return '';
  const s = String(value).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function downloadCSV(data, filename) {
  const headers = [
    'query', 'title', 'url', 'description', 'position',
    'additionalLinks', 'utm_source', 'utm_medium', 'utm_campaign',
    'utm_content', 'utm_term'
  ];

  const rows = [headers.join(',')];

  const sessions = data.sessions || [{ ads: data.ads, searchQuery: data.metadata?.searchQuery }];

  for (const session of sessions) {
    const query = session.searchQuery || session.query || '';
    for (const ad of (session.ads || [])) {
      const utm = ad.utmParams || {};
      rows.push([
        query,
        ad.title || '',
        ad.url || '',
        ad.description || '',
        ad.position != null ? ad.position : '',
        (ad.additionalLinks || []).map(l => typeof l === 'object' ? l.text : l).join('; '),
        utm.utm_source || '',
        utm.utm_medium || '',
        utm.utm_campaign || '',
        utm.utm_content || '',
        utm.utm_term || ''
      ].map(escapeCSV).join(','));
    }
  }

  const bom = '\uFEFF';
  const blob = new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
