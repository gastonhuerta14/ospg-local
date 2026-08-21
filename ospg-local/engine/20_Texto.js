function normalizar_(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[°ªº]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function aNumero_(x) {
  if (typeof x === 'number') return isNaN(x) ? null : x;
  if (x === null || x === undefined) return null;
  let s = String(x).trim();
  if (!s) return null;
  const negativo = s.charAt(0) === '(' && s.charAt(s.length - 1) === ')';
  s = s.replace(/[^\d,.\-]/g, '');
  if (!s) return null;

  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  } else if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const v = parseFloat(s);
  if (isNaN(v)) return null;
  return negativo ? -v : v;
}