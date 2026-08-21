'use strict';
/**
 * store.js — Reemplaza 40_Store.gs (guardarJson_ / leerJson_ sobre Drive).
 *
 * Dos mejoras sobre la versión de GAS, las dos señaladas en la auditoría:
 *
 *  1. ESCRITURA ATÓMICA. La versión de Drive hacía setTrashed() del archivo
 *     viejo y después createFile(). Si la ejecución moría en el medio, el
 *     archivo quedaba destruido. Acá se escribe a .tmp y se renombra: rename
 *     es atómico en el mismo filesystem, así que o está el archivo viejo o el
 *     nuevo, nunca nada a medias.
 *
 *  2. UNA SOLA COPIA. getFilesByName() de Drive devuelve un iterador y podía
 *     leer un duplicado. Acá la ruta es la identidad.
 */

const fs = require('node:fs');
const path = require('node:path');

function crearStore(dirSalida) {
  fs.mkdirSync(dirSalida, { recursive: true });

  function rutaDe(nombre) {
    if (nombre.includes('/') || nombre.includes('\\') || nombre.includes('..')) {
      throw new Error('Nombre de archivo inválido: ' + nombre);
    }
    return path.join(dirSalida, nombre);
  }

  function guardarJson(nombre, obj) {
    if (obj === undefined) {
      // La versión de GAS escribía el texto "undefined" encima del archivo
      // bueno del mes anterior cuando una fuente faltaba. Acá no se toca nada.
      return false;
    }
    const destino = rutaDe(nombre);
    const tmp = destino + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, destino);
    return true;
  }

  function leerJson(nombre) {
    const destino = rutaDe(nombre);
    if (!fs.existsSync(destino)) return null;
    try { return JSON.parse(fs.readFileSync(destino, 'utf8')); }
    catch (e) { return null; }
  }

  function existe(nombre) { return fs.existsSync(rutaDe(nombre)); }

  return { guardarJson, leerJson, existe, dir: dirSalida };
}

module.exports = { crearStore };
