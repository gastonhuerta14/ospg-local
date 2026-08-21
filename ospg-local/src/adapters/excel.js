'use strict';
/**
 * excel.js — Lectura de planillas desde el disco local.
 *
 * Reemplaza el truco de GAS de copiar el archivo forzando el MIME de Google
 * Sheets (Drive.Files.copy) para poder leerlo. Acá SheetJS lo lee directo.
 *
 * Ventaja concreta sobre GAS: SheetJS detecta el formato REAL por contenido.
 * Muchos ".xls" de sistemas hospitalarios son HTML o CSV renombrados; en Drive
 * eso a veces convierte mal y en silencio. Acá se detecta y se lee bien.
 *
 * El CSV se parsea sin dependencias, así que el proyecto arranca y se puede
 * probar aunque todavía no hayas instalado SheetJS.
 *
 * REGLA DE ORO de formatoReal(): la única decisión con consecuencias es
 * "csv vs. todo lo demás". Todo lo que no es csv se delega a SheetJS, que
 * re-olfatea el archivo por su cuenta y resuelve xls/xlsx/html/xml solo. Por
 * eso confundir html con xml es inofensivo, pero clasificar como csv algo que
 * no lo es inyecta basura silenciosa en un cálculo financiero. El fallback
 * NUNCA asume csv: exige que el contenido parezca texto plano, y si no, aborta.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('../gasShims');

let XLSX = null;
try { XLSX = require('xlsx'); } catch (e) { /* se avisa recién si hace falta */ }

/** Bytes que se leen para olfatear. 512 no alcanzaba: los exports estilo
 *  GridView/Jasper emiten un <style> de 1-3 KB antes del primer <table>. */
const VENTANA = 8192;

/** Devuelve la extensión real mirando los primeros bytes, no el nombre. */
function formatoReal(archivo) {
  const fd = fs.openSync(archivo, 'r');
  let head, n;
  try {
    const buf = Buffer.alloc(VENTANA);
    n = fs.readSync(fd, buf, 0, VENTANA, 0);
    head = buf.subarray(0, n);
  } finally {
    fs.closeSync(fd); // en finally: si readSync tira, el fd no queda filtrado
  }

  if (n === 0) {
    throw new Error('El archivo está vacío: ' + path.basename(archivo) +
                    '. El export del sistema origen falló; volvé a generarlo.');
  }

  // --- contenedores binarios: firma inequívoca -----------------------------
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'xls';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx';

  if (head.subarray(0, 4).toString('latin1') === '%PDF') {
    throw new Error(path.basename(archivo) + ' es un PDF renombrado a planilla, no una planilla. ' +
                    'Pedí el export en Excel o CSV al sistema origen.');
  }

  // --- texto: decodificar según BOM ANTES de buscar marcado -----------------
  // En UTF-16LE "<html" son los bytes 3C 00 68 00 74 00 ...; leído como latin1
  // eso es "<\0h\0t\0m\0l\0" y jamás matchea la subcadena "<html".
  const bom = detectarBom(head);
  const txt = decodificar(head, bom);
  const t = txt.toLowerCase();

  // SpreadsheetML 2003 va PRIMERO: también trae <Table>, pero lo resuelve el
  // parser XLML de SheetJS, no el de HTML. Si lo etiquetáramos 'html' le
  // recortaríamos el prólogo en leerPlanilla() y quedaría ilegible.
  if (t.includes('<workbook') ||
      t.includes('urn:schemas-microsoft-com:office:spreadsheet')) return 'xml';
  if (t.includes('<html') || t.includes('<table') || t.includes('<tr')) return 'html';
  if (t.includes('<?xml')) return 'xml';
  if (t.startsWith('{\\rtf')) return 'rtf';

  // --- fallback: sólo csv si DE VERDAD parece texto plano ------------------
  // Un NUL en la ventana significa binario. Antes esto caía en 'csv' y el
  // parser devolvía filas de basura sin lanzar una sola excepción.
  const sospechoso = bom === 'utf16le' || bom === 'utf16be' ? Buffer.from(txt, 'utf8') : head;
  if (sospechoso.includes(0x00)) {
    throw new Error('Formato no reconocido en ' + path.basename(archivo) +
                    ': el contenido es binario y no coincide con xls, xlsx, html ni csv. ' +
                    'Reexportalo desde el sistema origen.');
  }

  if (bom === 'utf16le') return 'csv-utf16-le';
  if (bom === 'utf16be') return 'csv-utf16-be';
  return 'csv';
}

/** 'utf16le' | 'utf16be' | 'utf8bom' | null */
function detectarBom(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le';
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be';
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf8bom';
  return null;
}

/** Decodifica a string respetando el BOM y descartándolo. */
function decodificar(buf, bom) {
  if (bom === 'utf16le') return buf.subarray(2).toString('utf16le');
  // swap16 muta, así que se copia antes de tocar el buffer del llamador.
  if (bom === 'utf16be') return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  if (bom === 'utf8bom') return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

/**
 * Devuelve una matriz de valores, equivalente a
 * `sheet.getDataRange().getValues()` de GAS.
 */
function leerPlanilla(archivo) {
  const tipo = formatoReal(archivo);

  if (tipo.indexOf('csv') === 0) {
    const raw = fs.readFileSync(archivo);
    const bom = tipo === 'csv-utf16-le' ? 'utf16le'
              : tipo === 'csv-utf16-be' ? 'utf16be'
              : detectarBom(raw);
    return parseCsv(decodificar(raw, bom));
  }

  if (!XLSX) {
    throw new Error(
      'Para leer ' + path.basename(archivo) + ' (formato ' + tipo + ') falta SheetJS.\n' +
      'Instalalo con:  npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'
    );
  }

  // Con HTML hay que FORZAR el parser de HTML. Si le pasamos el archivo crudo,
  // SheetJS re-olfatea por su cuenta: ve el prólogo <?xml de los exports de
  // Crystal/.NET y elige el parser XLML, que revienta con
  // "Cannot read properties of undefined". Recortar hasta el primer marcado
  // real resuelve eso, y de paso el UTF-16 se decodifica una sola vez, acá.
  let wb;
  if (tipo === 'html') {
    const raw = fs.readFileSync(archivo);
    const texto = decodificar(raw, detectarBom(raw));
    wb = XLSX.read(texto.slice(inicioMarcado(texto)), {
      type: 'string', raw: true, dense: true,
      cellStyles: false, cellNF: false, cellFormula: false
    });
  } else {
    // sheets:0 parsea SÓLO la primera hoja (la única que se usa) y dense:true
    // evita el objeto disperso: los dos recortan el pico de memoria en libros
    // grandes. cellStyles/NF/Formula off: no se usan y cuestan RAM.
    wb = XLSX.readFile(archivo, {
      cellDates: false, raw: true, dense: true, sheets: 0,
      cellStyles: false, cellNF: false, cellFormula: false
    });
  }

  const nombreHoja = wb.SheetNames[0];
  const hoja = wb.Sheets[nombreHoja];
  if (!hoja) {
    throw new Error('No se pudo leer la primera hoja de ' + path.basename(archivo));
  }
  // header:1 => matriz de filas, defval:'' => sin agujeros. Igual que getValues().
  return XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true, blankrows: false });
}

/** Primer marcado útil: descarta prólogo XML, DOCTYPE y bloques <style>. */
function inicioMarcado(texto) {
  const t = texto.toLowerCase();
  const marcas = ['<html', '<table', '<tr'];
  for (let i = 0; i < marcas.length; i++) {
    const pos = t.indexOf(marcas[i]);
    if (pos !== -1) return pos;
  }
  return 0;
}

/** Busca en la carpeta del período el archivo que matchea el patrón de la fuente. */
function localizarArchivo(dirPeriodo, patron) {
  if (!fs.existsSync(dirPeriodo)) {
    throw new Error('No existe la carpeta del período: ' + dirPeriodo);
  }
  const candidatos = fs.readdirSync(dirPeriodo)
    .filter(n => !n.startsWith('~$') && !n.startsWith('.'))
    .filter(n => patron.test(n));

  if (!candidatos.length) return null;
  if (candidatos.length > 1) {
    // Nunca elegir uno al azar: si hay ambigüedad, que el usuario la resuelva.
    throw new Error('Hay ' + candidatos.length + ' archivos que coinciden con ' + patron +
                    ': ' + candidatos.join(' · ') + '. Dejá uno solo en la carpeta.');
  }
  return path.join(dirPeriodo, candidatos[0]);
}

module.exports = {
  leerPlanilla, localizarArchivo, formatoReal,
  detectarBom, decodificar,
  tieneSheetJs: () => !!XLSX
};
