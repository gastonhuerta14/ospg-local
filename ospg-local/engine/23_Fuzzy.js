/**
 * 23_Fuzzy.gs — Similitud textual en JS puro. ACTUALIZADO.
 *
 * Cambio: el emparejamiento de tokens ahora tolera ABREVIATURAS y ERRATAS.
 * En estos archivos conviven 'AGUJA HIPODERM.' con 'AGUJA HIPODERMICA',
 * 'COMPR.' con 'COMPRIMIDOS', 'SOL.INY' con 'SOLUCION INYECTABLE'.
 * Con intersección exacta de tokens esos pares daban 0 de solapamiento y no
 * cruzaban nunca, por más que el resto coincidiera.
 */

/* ---------- Índice invertido de trigramas (blocking) ---------------------- */

function trigramas_(s) {
  const t = '  ' + normalizar_(s).replace(/\s+/g, ' ') + '  ';
  const out = [];
  for (let i = 0; i < t.length - 2; i++) out.push(t.substr(i, 3));
  return out;
}

function construirIndice_(registros) {
  const idx = new Map();
  registros.forEach((r, i) => {
    new Set(trigramas_(r.principioActivo)).forEach(g => {
      if (!idx.has(g)) idx.set(g, []);
      idx.get(g).push(i);
    });
  });
  return idx;
}

function candidatos_(pa, idx, minRatio) {
  const gramas = Array.from(new Set(trigramas_(pa)));
  const conteo = new Map();
  gramas.forEach(g => {
    const lista = idx.get(g);
    if (lista) lista.forEach(i => conteo.set(i, (conteo.get(i) || 0) + 1));
  });
  const min = Math.max(1, Math.ceil(gramas.length * (minRatio || 0.3)));
  const out = [];
  conteo.forEach((c, i) => { if (c >= min) out.push(i); });
  return out;
}

/* ---------- Levenshtein: dos filas + corte temprano ----------------------- */

function levenshtein_(a, b, techo) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > techo) return techo + 1;

  let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let mejorFila = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const costo = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + costo);
      if (cur[j] < mejorFila) mejorFila = cur[j];
    }
    if (mejorFila > techo) return techo + 1;
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[b.length];
}

/* ---------- Tokens tolerantes a abreviaturas ------------------------------ */

function tokensDe_(s) {
  const vistos = new Set(), out = [];
  normalizar_(s).split(/[^\wÑ]+/).forEach(t => {
    if (t.length > 1 && !vistos.has(t)) { vistos.add(t); out.push(t); }
  });
  return out;
}

/**
 * Dos tokens son "el mismo" si son iguales, si uno es prefijo del otro
 * (HIPODERM. / HIPODERMICA — la abreviatura es el caso dominante en estos
 * archivos) o si difieren en una sola letra (errata de tipeo).
 *
 * El piso de 4 caracteres para el prefijo es deliberado: sin él, 'AM' pegaría
 * con 'AMOXICILINA' y con 'AMLODIPINA' a la vez.
 */
function tokensEquivalentes_(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return true;
  if (min >= 5 && levenshtein_(a, b, 1) <= 1) return true;
  return false;
}

/**
 * Score 0..100. Mitad solapamiento de tokens (con equivalencia laxa), mitad
 * Levenshtein normalizado sobre los tokens ordenados — insensible al orden de
 * las palabras, que entre estos sistemas cambia todo el tiempo.
 */
function score_(a, b) {
  const A = tokensDe_(a), B = tokensDe_(b);
  if (!A.length || !B.length) return 0;

  const usados = new Set();
  let inter = 0;
  A.forEach(ta => {
    for (let i = 0; i < B.length; i++) {
      if (usados.has(i)) continue;
      if (tokensEquivalentes_(ta, B[i])) { usados.add(i); inter++; return; }
    }
  });
  const jaccard = inter / (A.length + B.length - inter);

  const sa = A.slice().sort().join(' '), sb = B.slice().sort().join(' ');
  const techo = Math.ceil(Math.max(sa.length, sb.length) * 0.5);
  const d = levenshtein_(sa, sb, techo);
  const lev = 1 - Math.min(d, techo) / Math.max(sa.length, sb.length, 1);

  return Math.round((0.5 * jaccard + 0.5 * lev) * 100);
}