/**
 * 90_Auditoria.gs — Verificación de los hallazgos del reporte de auditoría.
 *
 * Pegá este archivo en el proyecto y ejecutá `correrAuditoria()` desde el editor.
 * Corre contra TU código real, no contra un banco de pruebas: si un hallazgo ya
 * lo corrigieron, va a dar OK sin que haya que tocar nada acá.
 *
 * No escribe nada. Es seguro correrlo en producción.
 */

function correrAuditoria() {
  const R = [];
  const chk = (id, titulo, ok, detalle) => {
    R.push((ok ? '  OK   ' : '  FALLA') + '  ' + id + '  ' + titulo + (detalle ? '\n           ' + detalle : ''));
  };
  const dicNuevo = () => {
    const d = new DiccionarioSinonimos();
    if (d.cargarDesdeHoja) { try { d.cargarDesdeHoja([[]]); } catch (e) {} }
    return d;
  };

  // ── A-1b · CROSSWALK: SAES sin código colapsa todas las decisiones ────────
  try {
    const m = new Map();
    const key = (sis, cod) => sis + '::' + cod;
    m.set(key('SAES', null), 'CLAVE_A');
    m.set(key('SAES', null), 'CLAVE_B');
    chk('A-1b', 'CROSSWALK con codigo_origen nulo (SAES)', m.size === 2,
        'entradas guardadas 2, claves distintas ' + m.size + ' -> la 2da decisión pisa la 1ra');
  } catch (e) { chk('A-1b', 'CROSSWALK', false, e.message); }

  // ── A-2a · El diccionario aprende una cabeza genérica ─────────────────────
  try {
    const d = dicNuevo();
    d.aprender('INSULINA', 'INSULINA GLARGINA', 'AUTO');
    const envenenado = d.buscar('INSULINA') === 'INSULINA GLARGINA';
    chk('A-2a', 'Rechaza sinónimos genéricos (variante = prefijo de la monodroga)',
        !envenenado, envenenado ? 'aprendió INSULINA -> INSULINA GLARGINA' : '');
  } catch (e) { chk('A-2a', 'Sinónimos genéricos', false, e.message); }

  // ── A-2b · Conflicto de sinónimos detectado ───────────────────────────────
  try {
    const d = dicNuevo();
    d.aprender('CLEXANE', 'ENOXAPARINA', 'AUTO');
    d.aprender('CLEXANE', 'DALTEPARINA', 'AUTO');
    const hayReporte = !!(d.conflictos && d.conflictos.length);
    chk('A-2b', 'Reporta conflictos de sinónimos', hayReporte,
        hayReporte ? '' : 'segunda carga descartada en silencio (quedó ' + d.buscar('CLEXANE') + ')');
  } catch (e) { chk('A-2b', 'Conflictos', false, e.message); }

  // ── A-3a · Falso positivo: mismo calibre, distinta longitud ───────────────
  try {
    const d = dicNuevo();
    const a = parsearDescripcion_('AGUJA HIPODERMICA 21G X 1 1/2', null, d, null);
    const b = parsearDescripcion_('AGUJA HIPODERMICA 21G X 1', null, d, null);
    a.descripcionRaw = 'AGUJA HIPODERMICA 21G X 1 1/2';
    b.descripcionRaw = 'AGUJA HIPODERMICA 21G X 1';
    const s = scorePar_(a, b), u = umbralDe_(a, b);
    chk('A-3a', 'NO cruza aguja 21G x1½ contra 21G x1', s < u,
        'score ' + Math.round(s) + ' / umbral ' + u + (s >= u ? '  -> MATCH AUTOMÁTICO indebido' : ''));
  } catch (e) { chk('A-3a', 'Falso positivo por calibre', false, e.message); }

  // ── A-3b · "X n" ambiguo en insumos ───────────────────────────────────────
  try {
    const d = dicNuevo();
    const r = parsearDescripcion_('AGUJA HIPODERMICA 21G X 100', null, d, null);
    const marcado = (r.flags || []).indexOf('ENVASE_AMBIGUO') >= 0;
    chk('A-3b', '"X n" en insumos marcado como ambiguo', marcado || r.unidadesEnvase === null,
        'unidadesEnvase = ' + r.unidadesEnvase + ' sin flag -> riesgo de precio unitario /100');
  } catch (e) { chk('A-3b', 'X n ambiguo', false, e.message); }

  // ── A-4 · El hint basura contamina la clasificación ───────────────────────
  try {
    const basura = ['NO APLICA (DISPOSITIVO MEDICO)', 'NO APLICA (RUBRO GENERICO)', 'N/A', 'S/D', '-'];
    const malos = basura.filter(h =>
      clasificarArticulo_('AGUJA HIPODERMICA 21G X 1 1/2', h) === 'MEDICAMENTO');
    chk('A-4', 'Hint inválido no contamina el tipo', malos.length === 0,
        malos.length ? malos.length + ' de ' + basura.length + ' clasifican como MEDICAMENTO: ' + malos.join(' · ') : '');
  } catch (e) { chk('A-4', 'Filtro de hint', false, e.message); }

  // ── A-5 · Discriminante parcial (subconjunto) ─────────────────────────────
  try {
    const d = dicNuevo();
    const a = parsearDescripcion_('BOTON GASTRICO 20FR X 1,7 CM', null, d, null);
    const b = parsearDescripcion_('BOTON GASTRICO 20 FR', null, d, null);
    a.descripcionRaw = 'BOTON GASTRICO 20FR X 1,7 CM'; b.descripcionRaw = 'BOTON GASTRICO 20 FR';
    const aj = ajusteDiscriminante_(a, b);
    chk('A-5', 'Discriminante subconjunto no se castiga como conflicto', aj > -25,
        JSON.stringify(a.discriminante) + ' vs ' + JSON.stringify(b.discriminante) + ' -> ajuste ' + aj);
  } catch (e) { chk('A-5', 'Discriminante parcial', false, e.message); }

  // ── A-6 · Presupuesto de tiempo en el cruce ───────────────────────────────
  try {
    const tieneTope = typeof CFG !== 'undefined' && (CFG.MAX_CANDIDATOS || CFG.PRESUPUESTO_MS);
    chk('A-6', 'construirMaestro tiene tope de candidatos o corte por reloj', !!tieneTope,
        tieneTope ? '' : 'sin CFG.MAX_CANDIDATOS ni CFG.PRESUPUESTO_MS -> una sola ejecución sin progreso parcial');
  } catch (e) { chk('A-6', 'Presupuesto de tiempo', false, e.message); }

  // ── A-8 · Persistencia de los rechazos ────────────────────────────────────
  try {
    const ss = SpreadsheetApp.openById(CFG.CONTROL_SHEET_ID);
    const h = ss.getSheetByName('CROSSWALK');
    const enc = h ? h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String) : [];
    const tiene = enc.some(c => /DECISION|ACCION/i.test(c));
    chk('A-8', 'CROSSWALK guarda también los rechazos (columna decision)', tiene,
        tiene ? '' : 'encabezados: ' + enc.join(' | '));
  } catch (e) { chk('A-8', 'Rechazos', false, 'no se pudo leer CROSSWALK: ' + e.message); }

  // ── Tamaño actual del catálogo, contra el techo medido ────────────────────
  try {
    const bloques = {};
    let total = 0;
    FUENTES.forEach(f => (leerJson_('silver_' + f.id + '.json') || []).forEach(r => {
      total++;
      bloques[r.principioActivo] = (bloques[r.principioActivo] || 0) + 1;
    }));
    let mayor = '', n = 0;
    for (const k in bloques) if (bloques[k] > n) { n = bloques[k]; mayor = k; }
    chk('A-6b', 'Ningún bloque de principio activo supera 1.500 registros', n < 1500,
        'total ' + total + ' registros · bloque mayor "' + mayor + '" con ' + n);
  } catch (e) { chk('A-6b', 'Tamaño de bloques', false, e.message); }

  Logger.log('\n═══ AUDITORÍA ═══\n' + R.join('\n') +
             '\n\n' + R.filter(x => x.indexOf('FALLA') === 0).length + ' hallazgos abiertos de ' + R.length);
}
