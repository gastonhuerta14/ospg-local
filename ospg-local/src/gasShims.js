'use strict';
/**
 * gasShims.js — Implementaciones locales de los servicios de Google que el motor
 * usa, para que los archivos de `engine/` corran SIN UNA SOLA MODIFICACIÓN.
 *
 * La idea es no portar el motor: portar la superficie que el motor toca.
 * Son 9 métodos de SpreadsheetApp, 3 de Utilities, 1 de LockService. Nada más.
 * Mientras esos 13 se comporten igual, el mismo código corre en GAS y en Node.
 *
 * Las "hojas" son archivos CSV en data/control/. Se pueden abrir con Excel, con
 * VS Code o con Google Sheets: el equipo de Compras sigue editando el
 * diccionario a mano, que es lo que hace útil al sistema.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ------------------------------------------------------------------ CSV --- */

function parseCsv(texto) {
  const filas = [];
  let fila = [], campo = '', enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

function escribirCsv(filas) {
  return filas.map(f => f.map(v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n') + '\n';
}

/* -------------------------------------------------- Sheet / Spreadsheet --- */

/**
 * Implementa el subconjunto EXACTO de la API de Sheet que usa el motor:
 *   getLastRow · getLastColumn · getRange(f,c,nf,nc) · getDataRange
 *   .getValues() · .setValues() · appendRow · setFrozenRows · getName
 */
class HojaLocal {
  constructor(nombre, archivo) {
    this.nombre = nombre;
    this.archivo = archivo;
    this.sucia = false;
    this.datos = fs.existsSync(archivo) ? parseCsv(fs.readFileSync(archivo, 'utf8')) : [];
  }

  getName() { return this.nombre; }
  getLastRow() { return this.datos.length; }
  getLastColumn() { return this.datos.reduce((m, f) => Math.max(m, f.length), 0); }
  setFrozenRows() { return this; }

  getRange(fila, col, numFilas, numCols) {
    const hoja = this;
    const nf = numFilas === undefined ? 1 : numFilas;
    const nc = numCols === undefined ? 1 : numCols;
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nf; i++) {
          const f = hoja.datos[fila - 1 + i] || [];
          const r = [];
          for (let j = 0; j < nc; j++) r.push(f[col - 1 + j] === undefined ? '' : f[col - 1 + j]);
          out.push(r);
        }
        return out;
      },
      setValues(matriz) {
        matriz.forEach((f, i) => {
          const idx = fila - 1 + i;
          if (!hoja.datos[idx]) hoja.datos[idx] = [];
          f.forEach((v, j) => { hoja.datos[idx][col - 1 + j] = v; });
        });
        hoja.sucia = true;
        return this;
      }
    };
  }

  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }

  appendRow(fila) {
    this.datos.push(fila.map(v => (v === null || v === undefined ? '' : v)));
    this.sucia = true;
    return this;
  }

  guardar() {
    if (!this.sucia) return;
    fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
    fs.writeFileSync(this.archivo, escribirCsv(this.datos), 'utf8');
    this.sucia = false;
  }
}

class PlanillaLocal {
  constructor(dir) {
    this.dir = dir;
    this.hojas = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }
  getSheetByName(nombre) {
    if (this.hojas.has(nombre)) return this.hojas.get(nombre);
    const archivo = path.join(this.dir, nombre + '.csv');
    if (!fs.existsSync(archivo)) return null;          // igual que GAS: null si no existe
    const h = new HojaLocal(nombre, archivo);
    this.hojas.set(nombre, h);
    return h;
  }
  insertSheet(nombre) {
    const h = new HojaLocal(nombre, path.join(this.dir, nombre + '.csv'));
    h.sucia = true;
    this.hojas.set(nombre, h);
    return h;
  }
  flush() { this.hojas.forEach(h => h.guardar()); }
}

/* ------------------------------------------------------------- fábrica --- */

function crearShims(opciones) {
  const dirControl = opciones.dirControl;
  const planilla = new PlanillaLocal(dirControl);

  const SpreadsheetApp = {
    openById() { return planilla; },       // local: hay una sola planilla de control
    openByUrl() { return planilla; },
    flush() { planilla.flush(); },
    getActive() { return planilla; }
  };

  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    computeDigest: (_alg, valor) => Array.from(crypto.createHash('sha1').update(String(valor)).digest()),
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    DigestAlgorithm: { SHA_1: 'SHA_1', SHA_256: 'SHA_256', MD5: 'MD5' },
    sleep: (ms) => { const fin = Date.now() + ms; while (Date.now() < fin); }
  };

  // Un solo proceso Node: el lock es un booleano. Si algún día pasan a varios
  // workers, esto se cambia por un lockfile y nada más del motor se entera.
  let tomado = false;
  const LockService = {
    getScriptLock: () => ({
      tryLock(ms) { if (tomado) return false; tomado = true; return true; },
      releaseLock() { tomado = false; },
      hasLock() { return tomado; }
    })
  };

  const Session = {
    getActiveUser: () => ({ getEmail: () => opciones.usuario || 'local@ospg' }),
    getEffectiveUser: () => ({ getEmail: () => opciones.usuario || 'local@ospg' })
  };

  const Logger = { log: (...a) => console.log('[Logger]', ...a) };

  const MimeType = {
    GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
    PLAIN_TEXT: 'text/plain'
  };

  return { SpreadsheetApp, Utilities, LockService, Session, Logger, MimeType, planilla };
}

module.exports = { crearShims, PlanillaLocal, HojaLocal, parseCsv, escribirCsv };
