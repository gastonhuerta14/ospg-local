/**
 * 30_Cruce.gs — Cascada de matching. VERSIÓN CORREGIDA (code review final).
 *
 * Tres correcciones sobre la versión revisada:
 *
 *  1. EL NIVEL L0 ESTABA MUERTO. El crosswalk devuelve un `grupoId` y el código
 *     lo buscaba en `idxL2`, que está indexado por `claveL2`. Nunca encontraba
 *     nada. Ahora hay un índice propio por grupoId, y las dos puntas de la
 *     decisión humana apuntan al mismo grupo.
 *
 *  2. EL CORTE POR TIEMPO ERA UN BLOQUE VACÍO: `if (...) { /* corte *\/ }`.
 *     No hacía nada. Ahora corta de verdad y devuelve `truncado: true` con la
 *     cantidad de artículos que quedaron sin procesar — un recorte silencioso
 *     es peor que no tener recorte.
 *
 *  3. CFG.MAX_CANDIDATOS no se leía en ningún lado. Ahora acota el bloque a los
 *     K candidatos con mayor solapamiento de trigramas, que es lo que evita que
 *     un principio activo con cientos de filas dispare el costo cuadrático.
 */

function umbralSinDiscriminante_() {
  return (typeof CFG !== 'undefined' && CFG.UMBRAL_AUTO_SIN_DISC) || 96;
}
function maxCandidatos_() {
  return (typeof CFG !== 'undefined' && CFG.MAX_CANDIDATOS) || 50;
}
function presupuestoMs_() {
  return (typeof CFG !== 'undefined' && CFG.PRESUPUESTO_MS) || 240000;
}

/* ==========================================================================
 * Reglas de comparabilidad
 * ========================================================================== */

function comparables_(a, b) {
  if (a.tipo === 'AGREGADO' || b.tipo === 'AGREGADO') return false;
  if (a.tipo === b.tipo) return true;
  return a.tipo === 'INDETERMINADO' || b.tipo === 'INDETERMINADO';
}

/**
 * Ajuste por discriminante.
 *   iguales                 -> +15
 *   uno es subconjunto      ->  -8  (menos específico, no contradictorio)
 *   partes en conflicto     -> -25
 *   ninguno tiene           ->   0  (con umbral elevado)
 *   sólo uno tiene          ->  -3  (bajado de -8: que a un lado le falte tipear
 *                                    "MG" no debe hundir un cruce válido)
 */
function ajusteDiscriminante_(a, b) {
  const da = a.discriminante || '', db = b.discriminante || '';
  if (da && db) {
    if (da === db) return 15;
    const partesA = da.split('+'), partesB = db.split('+');
    const inter = partesA.filter(x => partesB.indexOf(x) >= 0);
    if (inter.length && (inter.length === partesA.length || inter.length === partesB.length)) return -8;
    return -25;
  }
  if (!da && !db) return 0;
  return -3;
}

function umbralDe_(a, b) {
  const sinDisc = !(a.discriminante || '') && !(b.discriminante || '');
  return sinDisc ? umbralSinDiscriminante_() : ((typeof CFG !== 'undefined' && CFG.UMBRAL_AUTO) || 92);
}

function scoreParBase_(a, b) {
  const sinDisc = !(a.discriminante || '') && !(b.discriminante || '');
  const wPA = sinDisc ? 0.35 : 0.65;
  const ta = a.textoComparable || a.descripcionRaw;
  const tb = b.textoComparable || b.descripcionRaw;
  return wPA * score_(a.principioActivo, b.principioActivo) + (1 - wPA) * score_(ta, tb);
}

function scorePar_(a, b) {
  return scoreParBase_(a, b) + ajusteDiscriminante_(a, b);
}

function admiteDeterminista_(r, nivel) {
  if (r.discriminante) return true;
  if (nivel === 'L1') return !!(r.forma && r.unidadesEnvase);
  return false;
}

/**
 * Top-K candidatos del bloque, ordenados por solapamiento de trigramas.
 * Sin este tope, un principio activo con 1.500 filas por lado dispara
 * 2.250.000 comparaciones y se come el presupuesto de 6 minutos.
 */
function candidatosTop_(pa, idx, minRatio, k) {
  const gramas = Array.from(new Set(trigramas_(pa)));
  const conteo = new Map();
  gramas.forEach(g => {
    const lista = idx.get(g);
    if (lista) lista.forEach(i => conteo.set(i, (conteo.get(i) || 0) + 1));
  });
  const min = Math.max(1, Math.ceil(gramas.length * (minRatio || 0.3)));
  const out = [];
  conteo.forEach((c, i) => { if (c >= min) out.push([i, c]); });
  if (out.length > k) {
    out.sort((a, b) => b[1] - a[1]);
    out.length = k;
  }
  return out.map(x => x[0]);
}

/* ==========================================================================
 * Cascada
 * ========================================================================== */

function cruzar_(gruposSMC, gruposOSPG, crosswalk) {
  const t0 = Date.now();
  const LIMITE_MS = presupuestoMs_();
  const K = maxCandidatos_();

  const der = Object.keys(gruposOSPG).map(k => gruposOSPG[k][0]);
  const excluidos = { smc: [], ospg: der.filter(r => r.tipo === 'AGREGADO') };

  const usados = new Set();
  der.forEach((r, j) => { if (r.tipo === 'AGREGADO') usados.add(j); });

  const idxL1 = new Map(), idxL2 = new Map(), idxL3 = new Map(), idxGrupo = new Map();
  der.forEach((r, j) => {
    if (r.tipo === 'AGREGADO') return;
    if (admiteDeterminista_(r, 'L1')) push_(idxL1, r.claveL1, j);
    if (admiteDeterminista_(r, 'L2')) push_(idxL2, r.claveL2, j);
    if (admiteDeterminista_(r, 'L3')) push_(idxL3, r.claveL3, j);

    // ÍNDICE POR GRUPO: acá es donde vive la decisión humana. Sin esto, L0 no
    // encontraba nunca su contraparte y el crosswalk era decorativo.
    const g = crosswalk.buscar(r.sistema, r.codigoOrigen);
    if (g) push_(idxGrupo, g, j);
  });

  const idxTri = construirIndice_(der);
  const pares = [], soloSMC = [], revision = [];
  const stats = { L0:0, L1:0, L2:0, L3:0, L4:0, revision:0, sinMatch:0,
                  rechazoPorTipo:0, rechazoPorDiscriminante:0, vetadoPorUsuario:0 };

  const clavesSMC = Object.keys(gruposSMC);
  let truncado = false, noProcesados = 0;

  for (let ki = 0; ki < clavesSMC.length; ki++) {

    // Corte real por presupuesto de tiempo (antes esto era un bloque vacío).
    if (Date.now() - t0 > LIMITE_MS) {
      truncado = true;
      noProcesados = clavesSMC.length - ki;
      break;
    }

    const r = gruposSMC[clavesSMC[ki]][0];
    if (r.tipo === 'AGREGADO') { excluidos.smc.push(r); continue; }

    let j = null, nivel = null, score = null;

    // ---- L0: decisión humana previa ---------------------------------------
    const grupo = crosswalk.buscar(r.sistema, r.codigoOrigen);
    if (grupo) {
      let c = (idxGrupo.get(grupo) || []).filter(x => !usados.has(x));
      // Compatibilidad con el formato viejo, donde el valor guardado era una claveL2
      if (!c.length && grupo.indexOf('|') >= 0) {
        c = (idxL2.get(grupo) || []).filter(x => !usados.has(x));
      }
      if (c.length) { j = c[0]; nivel = 'L0_CROSSWALK'; score = 100; stats.L0++; }
    }

    // ---- L1 / L2 / L3 -----------------------------------------------------
    if (j === null) {
      const intentos = [[r.claveL1, idxL1, 'L1_EXACTA', 'L1'],
                        [r.claveL2, idxL2, 'L2_DOSIS', 'L2'],
                        [r.claveL3, idxL3, 'L3_PA_DISCRIMINANTE', 'L3']];
      for (let t = 0; t < intentos.length && j === null; t++) {
        const clave = intentos[t][0];
        if (!clave || clave.charAt(0) === '|') continue;
        if (!admiteDeterminista_(r, intentos[t][3])) continue;

        const c = (intentos[t][1].get(clave) || []).filter(x =>
          !usados.has(x) &&
          comparables_(r, der[x]) &&
          !crosswalk.esRechazado(r.sistema, r.codigoOrigen, der[x].sistema, der[x].codigoOrigen));

        if (c.length) { j = c[0]; nivel = intentos[t][2]; score = 100; stats['L' + (t + 1)]++; }
      }
    }

    // ---- L4 / L5: fuzzy dentro del bloque acotado -------------------------
    if (j === null) {
      let mejor = null, mejorScore = -Infinity, mejorBase = 0;

      candidatosTop_(r.principioActivo, idxTri, 0.3, K).forEach(x => {
        if (usados.has(x)) return;
        if (!comparables_(r, der[x])) { stats.rechazoPorTipo++; return; }
        if (crosswalk.esRechazado(r.sistema, r.codigoOrigen, der[x].sistema, der[x].codigoOrigen)) {
          stats.vetadoPorUsuario++; return;
        }
        const base = scoreParBase_(r, der[x]);
        const s = base + ajusteDiscriminante_(r, der[x]);
        if (s > mejorScore) { mejor = x; mejorScore = s; mejorBase = base; }
      });

      const umbral = mejor !== null ? umbralDe_(r, der[mejor]) : 92;

      // La guillotina de score base existe para los INSUMOS: ahí "AGUJA 21G" y
      // "AGUJA 25G" comparten casi todo el texto y un base flojo es señal de
      // falso positivo. En MEDICAMENTOS el nombre de la droga ya es discriminante
      // fuerte, así que se confía en el puntaje total (que incluye el premio del
      // discriminante dinámico). Se exige si CUALQUIERA de los dos lados es
      // INSUMO: basta con que una punta sea material para querer la protección.
      const exigeBase = r.tipo === 'INSUMO' || der[mejor] && der[mejor].tipo === 'INSUMO';

      if (mejor !== null && mejorScore >= umbral && (!exigeBase || mejorBase >= 75)) {
        j = mejor; nivel = 'L4_FUZZY'; score = Math.round(mejorScore); stats.L4++;
      } else if (mejor !== null && mejorScore >= CFG.UMBRAL_REVISION) {
        const aj = ajusteDiscriminante_(r, der[mejor]);
        const motivo = aj === -25 ? 'DISCRIMINANTE_DISTINTO'
                     : (exigeBase && mejorBase < 75 ? 'BASE_TEXTUAL_BAJA'
                     : (!(r.discriminante) && !(der[mejor].discriminante) ? 'SIN_DISCRIMINANTE' : 'SCORE_INTERMEDIO'));
        if (motivo === 'DISCRIMINANTE_DISTINTO') stats.rechazoPorDiscriminante++;
        revision.push({ smc: r, candidato: der[mejor], score: Math.round(mejorScore),
                        base: Math.round(mejorBase), motivo: motivo, umbralAplicado: umbral });
        stats.revision++;
      }
    }

    if (j === null) { soloSMC.push(r); stats.sinMatch++; }
    else { usados.add(j); pares.push({ smc: r, ospg: der[j], nivel: nivel, score: score }); }
  }

  const soloOSPG = der.filter((r, j) => !usados.has(j) && r.tipo !== 'AGREGADO');

  return { pares: pares, soloSMC: soloSMC, soloOSPG: soloOSPG, revision: revision,
           excluidos: excluidos, stats: stats,
           truncado: truncado, noProcesados: noProcesados,
           duracionMs: Date.now() - t0 };
}

function push_(mapa, clave, valor) {
  if (!mapa.has(clave)) mapa.set(clave, []);
  mapa.get(clave).push(valor);
}

/* ==========================================================================
 * CROSSWALK — identidad estable de las dos puntas
 * ========================================================================== */

class CrosswalkManager {
  constructor() {
    this.mapa = new Map();      // 'sistema|id' -> grupoId
    this.rechazos = new Map();  // pares vetados por el usuario
  }

  buscar(sistema, codigo) {
    if (!sistema || !codigo) return null;
    return this.mapa.get(sistema + '|' + String(codigo).trim()) || null;
  }

  esRechazado(sisA, codA, sisB, codB) {
    if (!codA || !codB) return false;
    const a = sisA + '|' + String(codA).trim(), b = sisB + '|' + String(codB).trim();
    return this.rechazos.has(a + '||' + b) || this.rechazos.has(b + '||' + a);
  }

  cargarDesdeHoja(valores) {
    if (!valores || valores.length < 2) return 0;

    const cols = {};
    valores[0].forEach((c, i) => { cols[String(c).toLowerCase().trim()] = i; });
    const esFormatoViejo = cols['codigo_origen'] !== undefined;

    for (let i = 1; i < valores.length; i++) {
      const fila = valores[i];

      if (esFormatoViejo) {
        const sis = fila[cols['sistema']], cod = fila[cols['codigo_origen']], clave = fila[cols['clave_canonica']];
        if (sis && cod && clave) this.mapa.set(sis + '|' + String(cod).trim(), String(clave));
        continue;
      }

      const sA = fila[cols['sistemaa']], idA = fila[cols['ida']];
      const sB = fila[cols['sistemab']], idB = fila[cols['idb']];
      const dec = String(fila[cols['decision']] || '').toUpperCase();
      const grp = fila[cols['grupoid']];

      if (dec === 'UNIR' && grp) {
        // Las DOS puntas apuntan al mismo grupo: eso es lo que hace que el
        // match sobreviva a cualquier cambio futuro del parser.
        if (sA && idA) this.mapa.set(sA + '|' + String(idA).trim(), String(grp));
        if (sB && idB) this.mapa.set(sB + '|' + String(idB).trim(), String(grp));
      } else if (dec === 'NO_UNIR' && sA && idA && sB && idB) {
        this.rechazos.set(sA + '|' + String(idA).trim() + '||' + sB + '|' + String(idB).trim(), true);
      }
    }
    return this.mapa.size;
  }
}
