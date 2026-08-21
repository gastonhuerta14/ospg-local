'use strict';
/**
 * api.js — Puerto de 02_Api.gs a Node.
 *
 * Este archivo SÍ se reescribe: en GAS era casi todo llamadas a servicios de
 * Google (Session, LockService, SpreadsheetApp). La lógica de negocio no está
 * acá — está en engine/, que no se tocó.
 *
 * Mantiene la MISMA envoltura de respuesta `{ok, data, error}` que usaba el
 * frontend con google.script.run, así que el cliente sólo cambia el transporte.
 */

const path = require('node:path');
const { cargarMotor } = require('./engineLoader');

function crearApi(opciones) {
  const motor = cargarMotor(opciones);
  const store = motor.store;
  const CFG = motor.CFG;
  const FUENTES = motor.FUENTES;

  // Un solo proceso: alcanza con un booleano. Evita que dos pestañas disparen
  // la ingesta a la vez y se pisen los silver.
  let ocupado = false;
  function conLock(fn) {
    if (ocupado) { const e = new Error('El sistema está procesando. Reintentá en un minuto.'); e.code = 'BUSY'; throw e; }
    ocupado = true;
    try { return fn(); } finally { ocupado = false; }
  }

  /* ---------------------------------------------------------- usuarios --- */

  function verificarAcceso() {
    const email = opciones.usuario || 'local@ospg';
    const planilla = motor.shims.planilla;
    const hoja = planilla.getSheetByName('USUARIOS');

    // En local, sin hoja USUARIOS, se corre como editor: es tu propia máquina.
    // En el despliegue real esto tiene que fallar cerrado (ver README).
    if (!hoja) return { email, rol: 'editor', modo: 'local-sin-allowlist' };

    const filas = hoja.getDataRange().getValues();
    const fila = filas.find(u => u[0] && String(u[0]).trim().toLowerCase() === email.toLowerCase());
    if (!fila) { const e = new Error('ACCESO_DENEGADO: ' + email); e.code = 'AUTH'; throw e; }
    const rol = String(fila[1] || '').trim().toLowerCase();
    return { email, rol: rol === 'editor' ? 'editor' : 'lector' };
  }

  function exigirEditor() {
    const u = verificarAcceso();
    if (u.rol !== 'editor') { const e = new Error('Sólo los editores pueden ejecutar esta acción.'); e.code = 'AUTH'; throw e; }
    return u;
  }

  /* -------------------------------------------- re-resolución (era 02_Api) */

  function reResolverRegistros(registros, dic) {
    if (!registros || !registros.length) return 0;
    let cambios = 0;
    registros.forEach(r => {
      if (r.origenPA !== 'REGEX') return;
      const mono = dic.buscar(r.principioActivo);
      if (!mono || mono === r.principioActivo) return;
      r.paOriginal = r.principioActivo;
      r.principioActivo = mono;
      r.origenPA = 'DICCIONARIO';
      motor.llamar('construirClaves_', r);
      cambios++;
    });
    return cambios;
  }

  function reResolverArchivosPrevios(dic, indiceActual) {
    let total = 0;
    FUENTES.forEach((f, i) => {
      if (i === indiceActual) return;
      const datos = store.leerJson('silver_' + f.id + '.json');
      if (!datos || !datos.length) return;
      const cambios = reResolverRegistros(datos, dic);
      if (cambios) { store.guardarJson('silver_' + f.id + '.json', datos); total += cambios; }
    });
    return total;
  }

  /* ------------------------------------------------------------ acciones --- */

  function estado() {
    const usuario = verificarAcceso();
    const gold = store.leerJson('gold_maestro.json');
    const rev = store.leerJson('gold_revision.json');
    const archivos = FUENTES.map(f => ({
      id: f.id, sistema: f.sistema, lado: f.lado,
      silver: store.existe('silver_' + f.id + '.json')
    }));
    return {
      periodo: CFG.PERIODO,
      usuario,
      archivos,
      gold: { existe: !!(gold && gold.length), articulos: gold ? gold.length : 0 },
      enRevision: rev ? rev.length : 0,
      entrada: path.join(opciones.dirDatos || path.join(opciones.raiz, 'data'), 'entrada', CFG.PERIODO)
    };
  }

  function ingestarArchivo(indice) {
    return conLock(() => {
      exigirEditor();
      const fuente = FUENTES[indice];
      if (!fuente) { const e = new Error('Índice de fuente inválido: ' + indice); e.code = 'RANGO'; throw e; }

      const planilla = motor.shims.planilla;
      const hoja = motor.llamar('abrirHojaDiccionario_');
      const Dic = motor.eval('DiccionarioSinonimos');
      const dic = new Dic();
      dic.cargarDesdeHoja(hoja);
      const previos = dic.mapa.size;

      const res = motor.llamar('ingestarFuente_', indice, dic);

      if (!res.datos) {   // FALTANTE: no se toca el silver anterior
        res.diccionario = { previos, aprendidos: 0, total: dic.mapa.size };
        res.reResueltos = 0;
        return res;
      }

      const aprendidos = dic.guardarNuevosEnHoja(hoja);
      if (dic.conflictos && dic.conflictos.length) guardarConflictos(dic.conflictos);
      planilla.flush();

      let reResueltos = reResolverRegistros(res.datos, dic);
      store.guardarJson('silver_' + fuente.id + '.json', res.datos);
      reResueltos += reResolverArchivosPrevios(dic, indice);

      delete res.datos;
      res.diccionario = { previos, aprendidos, total: dic.mapa.size };
      res.conflictos = dic.conflictos ? dic.conflictos.length : 0;
      res.reResueltos = reResueltos;
      return res;
    });
  }

  function guardarConflictos(conflictos) {
    const planilla = motor.shims.planilla;
    let h = planilla.getSheetByName('DIC_CONFLICTOS');
    if (!h) {
      h = planilla.insertSheet('DIC_CONFLICTOS');
      h.getRange(1, 1, 1, 4).setValues([['variante', 'monodroga_nueva', 'monodroga_vigente', 'fecha']]);
    }
    const fecha = new Date().toISOString();
    conflictos.forEach(c => h.appendRow([c[0], c[1], c[2], fecha]));
  }

  function construirMaestro() {
    return conLock(() => {
      exigirEditor();
      const planilla = motor.shims.planilla;

      const CW = motor.eval('CrosswalkManager');
      const cw = new CW();
      const hojaCW = planilla.getSheetByName('CROSSWALK');
      if (hojaCW && hojaCW.getLastRow() > 1) cw.cargarDesdeHoja(hojaCW.getDataRange().getValues());

      let silver = [];
      FUENTES.forEach(f => {
        const d = store.leerJson('silver_' + f.id + '.json');
        if (d && d.length) silver = silver.concat(d);
      });
      if (!silver.length) { const e = new Error('No hay registros ingeridos. Ejecutá la ingesta primero.'); e.code = 'SIN_DATOS'; throw e; }

      const resultado = motor.llamar('construirMaestroCore_', silver, cw);
      store.guardarJson('gold_maestro.json', resultado.maestro);
      store.guardarJson('gold_revision.json', resultado.revision);

      return {
        articulos: resultado.maestro.length,
        enRevision: resultado.revision.length,
        truncado: !!resultado.truncado,
        noProcesados: resultado.noProcesados || 0,
        duracionMs: resultado.duracionMs,
        stats: resultado.stats,
        qa: validar(silver, resultado.maestro)
      };
    });
  }

  function validar(silver, maestro) {
    const suma = (arr, fn) => arr.reduce((a, x) => a + (fn(x) || 0), 0);
    const checks = [];
    [['SMC', 'smc'], ['OSPG', 'ospg']].forEach(par => {
      const origen = suma(silver.filter(r => r.lado === par[0]), r => r.totalLinea);
      const fin = suma(maestro, m => (m[par[1]] ? m[par[1]].total : 0));
      const delta = origen - fin;
      checks.push({
        check: 'Reconciliación de importes ' + par[0],
        origen: Math.round(origen * 100) / 100,
        maestro: Math.round(fin * 100) / 100,
        delta: Math.round(delta * 100) / 100,
        ok: Math.abs(delta) < Math.max(origen * 0.0001, 0.01)
      });
    });
    const vistas = new Set();
    let dup = 0;
    maestro.forEach(m => { if (vistas.has(m.clave)) dup++; else vistas.add(m.clave); });
    checks.push({ check: 'Sin claves duplicadas', delta: dup, ok: dup === 0 });
    checks.push({
      check: 'Diferencias > 500% (revisar unidad de medida)',
      delta: maestro.filter(m => m.difPct !== null && m.difPct > 500).length, ok: true
    });
    return checks;
  }

  function getMaestro() { verificarAcceso(); return store.leerJson('gold_maestro.json') || []; }
  function getRevision() { verificarAcceso(); return store.leerJson('gold_revision.json') || []; }

  function getDetalle(clave) {
    verificarAcceso();
    if (!clave) { const e = new Error('Falta la clave del artículo.'); e.code = 'RANGO'; throw e; }
    const lineas = [];
    FUENTES.forEach(f => {
      (store.leerJson('silver_' + f.id + '.json') || []).forEach(r => { if (r.claveL2 === clave) lineas.push(r); });
    });
    const porSistema = {};
    lineas.forEach(r => {
      const s = porSistema[r.sistema] || (porSistema[r.sistema] =
        { sistema: r.sistema, lineas: 0, unidades: 0, total: 0, precioMin: null, precioMax: null });
      s.lineas++;
      s.unidades += r.unidadesMinimas || 0;
      s.total += r.totalLinea || 0;
      if (r.precioUnitario != null) {
        if (s.precioMin === null || r.precioUnitario < s.precioMin) s.precioMin = r.precioUnitario;
        if (s.precioMax === null || r.precioUnitario > s.precioMax) s.precioMax = r.precioUnitario;
      }
    });
    return { clave, lineas, resumenPorSistema: Object.values(porSistema) };
  }

  function guardarDecision(sistemaA, idA, sistemaB, idB, decision) {
    return conLock(() => {
      const usr = exigirEditor();
      const dec = String(decision || '').toUpperCase();
      if (dec !== 'UNIR' && dec !== 'NO_UNIR') { const e = new Error('decision debe ser UNIR o NO_UNIR.'); e.code = 'RANGO'; throw e; }
      if (!sistemaA || !idA || !sistemaB || !idB) { const e = new Error('Faltan identificadores.'); e.code = 'RANGO'; throw e; }

      const planilla = motor.shims.planilla;
      let hoja = planilla.getSheetByName('CROSSWALK');
      if (!hoja) {
        hoja = planilla.insertSheet('CROSSWALK');
        hoja.getRange(1, 1, 1, 8).setValues([['sistemaA', 'idA', 'sistemaB', 'idB', 'decision', 'grupoId', 'usuario', 'fecha']]);
      }
      const grupoId = dec === 'UNIR' ? 'G-' + motor.shims.Utilities.getUuid().substring(0, 8) : '';
      hoja.appendRow([sistemaA, String(idA), sistemaB, String(idB), dec, grupoId, usr.email, new Date().toISOString()]);
      planilla.flush();
      return { grupoId, decision: dec };
    });
  }

  function agregarSinonimo(variante, monodroga) {
    return conLock(() => {
      exigirEditor();
      const v = motor.llamar('normalizar_', variante);
      const m = motor.llamar('normalizar_', monodroga);
      if (!v || !m) { const e = new Error('Variante y monodroga son obligatorias.'); e.code = 'RANGO'; throw e; }
      const hoja = motor.llamar('abrirHojaDiccionario_');
      hoja.appendRow([v, m, 'MANUAL', new Date().toISOString()]);
      motor.shims.planilla.flush();
      return { variante: v, monodroga: m };
    });
  }

  function auditoria() { verificarAcceso(); motor.llamar('correrAuditoria'); return { ok: true }; }

  return { motor, estado, ingestarArchivo, construirMaestro, getMaestro, getRevision,
           getDetalle, guardarDecision, agregarSinonimo, auditoria };
}

module.exports = { crearApi };
