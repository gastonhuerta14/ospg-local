/* ==========================================================================
 * 22_Diccionario.gs — Diccionario (VERSIÓN BLINDADA AUDITORÍA)
 * ========================================================================== */

const DIC_HOJA = 'DIC_SINONIMOS';
const DIC_ENCABEZADOS = ['variante', 'monodroga', 'origen', 'fecha'];
const GENERICOS_DESCARTADOS = new Set(['INSULINA','VACUNA','SUERO','SOLUCION','AGUA','HEPARINA']);

class DiccionarioSinonimos {
  constructor() {
    this.mapa = new Map();
    this.origenes = new Map();
    this.nuevos = [];
    this.hoja = null;
    this.conflictos = []; // Almacén de choques
  }

  buscar(variante) {
    if (!variante) return null;
    return this.mapa.get(normalizar_(variante)) || null;
  }

  aprender(variante, monodroga, origen) {
    const v = normalizar_(variante);
    const m = normalizar_(monodroga);
    if (!v || !m || v === m) return false;
    
    // NUEVO: Defensa contra Genéricos Destructivos (A-2a)
    if (v.length < 5 || GENERICOS_DESCARTADOS.has(v)) return false;
    const tokensV = v.split(' ');
    if (tokensV.length === 1 && m.indexOf(v) === 0) return false; 
    
    if (this.mapa.has(v)) {
      // NUEVO: Detección de Conflictos (A-2b)
      if (this.mapa.get(v) !== m) {
         this.conflictos.push([v, m, this.mapa.get(v)]);
      }
      return false;
    }
    this.mapa.set(v, m);
    this.origenes.set(v, origen || 'AUTO');
    this.nuevos.push([v, m, origen || 'AUTO', new Date().toISOString()]);
    return true;
  }

  cargarDesdeHoja(fuente) {
    let valores;
    if (!fuente) throw new Error('DIC: cargarDesdeHoja() necesita Sheet o valores.');
    else if (Array.isArray(fuente)) valores = fuente;
    else {
      this.hoja = fuente;
      const ultima = fuente.getLastRow();
      valores = ultima < 2 ? [] : fuente.getRange(1, 1, ultima, DIC_ENCABEZADOS.length).getValues();
    }
    const autos = [], manuales = [];
    for (let i = 1; i < valores.length; i++) {
      const v = normalizar_(valores[i][0]);
      const m = normalizar_(valores[i][1]);
      if (!v || !m) continue;
      const origen = normalizar_(valores[i][2]) === 'MANUAL' ? 'MANUAL' : 'AUTO';
      (origen === 'MANUAL' ? manuales : autos).push([v, m, origen]);
    }
    autos.concat(manuales).forEach(f => {
      this.mapa.set(f[0], f[1]);
      this.origenes.set(f[0], f[2]);
    });
    return this.mapa.size;
  }

  guardarNuevosEnHoja(sheet) {
    const hoja = sheet || this.hoja;
    if (!hoja) throw new Error('DIC: no hay hoja destino.');
    if (!this.nuevos.length) return 0;
    const ultima = hoja.getLastRow();
    if (ultima >= 2) {
      const yaEstan = new Set(hoja.getRange(2, 1, ultima - 1, 1).getValues().map(f => normalizar_(f[0])));
      this.nuevos = this.nuevos.filter(f => !yaEstan.has(f[0]));
      if (!this.nuevos.length) return 0;
    }
    const filas = this.nuevos;
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, DIC_ENCABEZADOS.length).setValues(filas);
    SpreadsheetApp.flush();
    this.nuevos = [];
    return filas.length;
  }
}

function abrirHojaDiccionario_() {
  if (!CFG.CONTROL_SHEET_ID) throw new Error('CFG.CONTROL_SHEET_ID vacío.');
  const ss = SpreadsheetApp.openById(CFG.CONTROL_SHEET_ID);
  let hoja = ss.getSheetByName(DIC_HOJA);
  if (!hoja) {
    hoja = ss.insertSheet(DIC_HOJA);
    hoja.getRange(1, 1, 1, DIC_ENCABEZADOS.length).setValues([DIC_ENCABEZADOS]);
    hoja.setFrozenRows(1);
  } else if (hoja.getLastRow() === 0) {
    hoja.getRange(1, 1, 1, DIC_ENCABEZADOS.length).setValues([DIC_ENCABEZADOS]);
    hoja.setFrozenRows(1);
  }
  return hoja;
}