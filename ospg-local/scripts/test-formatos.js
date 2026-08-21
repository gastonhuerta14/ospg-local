'use strict';
/**
 * test-formatos.js — Blindaje de src/adapters/excel.js.
 *
 * Por qué existe: la versión original de formatoReal() terminaba en
 * `return 'csv'` como fallback ciego. Todo lo que no reconocía —HTML con un
 * <style> largo adelante, cualquier cosa en UTF-16, un PDF renombrado, un
 * archivo vacío— se parseaba como texto plano y devolvía FILAS DE BASURA sin
 * lanzar una sola excepción. En un cruce de importes eso es inaceptable: no
 * hay error que ver, sólo números mal.
 *
 * Las fixtures se generan en tiempo de ejecución (nada de blobs binarios en el
 * repo) e imitan exports reales de sistemas hospitalarios.
 *
 *   npm run test:formatos
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const excel = require('../src/adapters/excel');

const BS = String.fromCharCode(92);           // backslash literal, para el RTF
const DIR = path.join(os.tmpdir(), 'ospg-fixtures-formatos');

/* ------------------------------------------------------------- helpers --- */

function escribir(nombre, buf) {
  const p = path.join(DIR, nombre);
  fs.writeFileSync(p, buf);
  return p;
}

function utf16le(texto, conBom) {
  const cuerpo = Buffer.from(texto, 'utf16le');
  return conBom ? Buffer.concat([Buffer.from([0xff, 0xfe]), cuerpo]) : cuerpo;
}

function utf16be(texto) {
  const cuerpo = Buffer.from(texto, 'utf16le').swap16();
  return Buffer.concat([Buffer.from([0xfe, 0xff]), cuerpo]);
}

/** Tabla HTML mínima con datos reconocibles, en el estilo de los exports. */
const TABLA = '<table><tr><td>DROGA</td><td>IMPORTE</td></tr>' +
              '<tr><td>RITUXIMAB</td><td>1.234,56</td></tr></table>';

/* ------------------------------------------------------------- fixtures -- */

const casos = [

  { n: '01-mso-websave.xls',
    desc: 'Excel "Guardar como pagina web" renombrado a .xls',
    formato: 'html',
    lee: { filas: 2, contiene: 'RITUXIMAB' },
    build: () => escribir('01-mso-websave.xls', Buffer.from(
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"' + os.EOL +
      'xmlns:x="urn:schemas-microsoft-com:office:excel"' + os.EOL +
      'xmlns="http://www.w3.org/TR/REC-html40">' + os.EOL +
      '<head><meta name=ProgId content=Excel.Sheet></head>' + os.EOL +
      '<body>' + TABLA + '</body></html>', 'utf8')) },

  { n: '02-crystal.xls',
    desc: 'Crystal/.NET: prologo XML + DOCTYPE largo antes del <html>',
    formato: 'html',
    lee: { filas: 2, contiene: 'RITUXIMAB' },
    build: () => escribir('02-crystal.xls', Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>' + os.EOL +
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ' +
      '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' + os.EOL +
      '<html xmlns="http://www.w3.org/1999/xhtml"><body>' + TABLA +
      '</body></html>', 'utf8')) },

  // REGRESION: con la ventana de 512 bytes esto se detectaba como 'csv' y
  // devolvia 12 filas de basura empezando por ["<style type=text/css>"].
  { n: '03-gridview.xls',
    desc: 'GridView: <style> de ~1KB, <table> recien en el byte 996, sin <html>',
    formato: 'html',
    lee: { filas: 2, contiene: 'RITUXIMAB' },
    build: () => {
      const css = '<style type="text/css">' + os.EOL +
        ('.hdr{font-family:Arial;font-size:10pt;font-weight:bold;' +
         'border:1px solid #999;background:#DDD;padding:2px;}' + os.EOL).repeat(9) +
        '</style>' + os.EOL;
      return escribir('03-gridview.xls', Buffer.from(css + TABLA, 'utf8'));
    } },

  // SpreadsheetML matchea <Table>, asi que cae en 'html'. Es INOFENSIVO: la
  // unica decision con consecuencias es csv-vs-no-csv, y SheetJS re-olfatea.
  { n: '04-spreadsheetml2003.xls',
    desc: 'SpreadsheetML 2003 guardado como .xls (sistemas viejos)',
    formato: ['html', 'xml'],
    lee: { contiene: 'RITUXIMAB' },
    build: () => escribir('04-spreadsheetml2003.xls', Buffer.from(
      '<?xml version="1.0"?>' + os.EOL +
      '<?mso-application progid="Excel.Sheet"?>' + os.EOL +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"' + os.EOL +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' + os.EOL +
      '<Worksheet ss:Name="Hoja1"><Table>' +
      '<Row><Cell><Data ss:Type="String">DROGA</Data></Cell></Row>' +
      '<Row><Cell><Data ss:Type="String">RITUXIMAB</Data></Cell></Row>' +
      '</Table></Worksheet></Workbook>', 'utf8')) },

  // REGRESION: en latin1 "<html" era "<\0h\0t\0m\0l\0" y nunca matcheaba.
  { n: '05-utf16le-html.xls',
    desc: 'HTML enmascarado en UTF-16LE (exports .NET con Encoding.Unicode)',
    formato: 'html',
    lee: { filas: 2, contiene: 'RITUXIMAB' },
    build: () => escribir('05-utf16le-html.xls',
      utf16le('<html><body>' + TABLA + '</body></html>', true)) },

  { n: '06-real-biff8.xls',
    desc: '.xls real (contenedor CFB/OLE2) escrito por SheetJS',
    formato: 'xls',
    lee: { filas: 2, contiene: 'RITUXIMAB' },
    build: () => {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet([['DROGA', 'IMPORTE'], ['RITUXIMAB', 1234.56]]), 'Hoja1');
      const p = path.join(DIR, '06-real-biff8.xls');
      XLSX.writeFile(wb, p, { bookType: 'biff8' });
      return p;
    } },

  { n: '07-real.xlsx',
    desc: '.xlsx real (contenedor ZIP/OOXML) escrito por SheetJS',
    formato: 'xlsx',
    lee: { filas: 2, contiene: 'RITUXIMAB' },
    build: () => {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet([['DROGA', 'IMPORTE'], ['RITUXIMAB', 1234.56]]), 'Hoja1');
      const p = path.join(DIR, '07-real.xlsx');
      XLSX.writeFile(wb, p);
      return p;
    } },

  { n: '08-bom.csv',
    desc: 'CSV con BOM UTF-8 (Excel es-AR)',
    formato: 'csv',
    // El BOM no debe quedar pegado a la primera celda o rompe el header.
    lee: { filas: 2, primeraCelda: 'DROGA' },
    build: () => escribir('08-bom.csv', Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('DROGA,IMPORTE' + os.EOL + 'RITUXIMAB,1234.56' + os.EOL, 'utf8')])) },

  // REGRESION: antes devolvia mojibake con NULs interleaved.
  { n: '09-utf16le.csv',
    desc: 'CSV UTF-16LE con comas',
    formato: 'csv-utf16-le',
    lee: { filas: 2, primeraCelda: 'DROGA', contiene: 'RITUXIMAB' },
    build: () => escribir('09-utf16le.csv',
      utf16le('DROGA,IMPORTE' + os.EOL + 'RITUXIMAB,1234.56' + os.EOL, true)) },

  { n: '10-utf16be.csv',
    desc: 'CSV UTF-16BE (big endian)',
    formato: 'csv-utf16-be',
    lee: { filas: 2, primeraCelda: 'DROGA', contiene: 'RITUXIMAB' },
    build: () => escribir('10-utf16be.csv',
      utf16be('DROGA,IMPORTE' + os.EOL + 'RITUXIMAB,1234.56' + os.EOL)) },

  { n: '11-renombrado.xls',
    desc: 'PDF renombrado a .xls',
    formato: { throws: 'PDF renombrado' },
    build: () => escribir('11-renombrado.xls',
      Buffer.concat([Buffer.from('%PDF-1.4', 'latin1'),
                     Buffer.from([0x0a, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])])) },

  { n: '12-vacio.xls',
    desc: 'Archivo vacio (export del sistema origen fallido)',
    formato: { throws: 'vac' },
    build: () => escribir('12-vacio.xls', Buffer.alloc(0)) },

  { n: '13-binario.xls',
    desc: 'Binario sin firma conocida (con bytes NUL)',
    formato: { throws: 'binario' },
    build: () => escribir('13-binario.xls', Buffer.from([
      0x1f, 0x00, 0x8b, 0x00, 0x42, 0x00, 0x99, 0x01, 0x00, 0x77, 0x00, 0x13])) },

  { n: '14-rtf.xls',
    desc: 'RTF renombrado a .xls',
    formato: 'rtf',
    build: () => escribir('14-rtf.xls', Buffer.from(
      '{' + BS + 'rtf1' + BS + 'ansi' + BS + 'deff0 DROGA RITUXIMAB}', 'latin1')) },

  // Limitacion conocida y DELIBERADA: parseCsv() solo corta por coma. El
  // encoding se resuelve bien (sin NULs), pero un TSV queda en una columna.
  // Si aparecen TSV reales hay que sniffear el delimitador en gasShims.
  { n: '15-utf16le-tab.csv',
    desc: '"Texto Unicode" de Excel: UTF-16LE separado por TABS',
    formato: 'csv-utf16-le',
    lee: { filas: 2, contiene: 'RITUXIMAB', columnasEsperadas: 1 },
    build: () => escribir('15-utf16le-tab.csv',
      utf16le('DROGA\tIMPORTE' + os.EOL + 'RITUXIMAB\t1234.56' + os.EOL, true)) }
];

/* -------------------------------------------------------------- runner --- */

function chequearLectura(matriz, esperado) {
  const fallas = [];
  if (esperado.filas !== undefined && matriz.length !== esperado.filas) {
    fallas.push('esperaba ' + esperado.filas + ' filas, hubo ' + matriz.length);
  }
  if (esperado.primeraCelda !== undefined) {
    const c = matriz.length ? String(matriz[0][0]) : '';
    if (c !== esperado.primeraCelda) {
      fallas.push('primera celda "' + c + '" != "' + esperado.primeraCelda + '"');
    }
  }
  if (esperado.contiene !== undefined) {
    const plano = JSON.stringify(matriz);
    if (plano.indexOf(esperado.contiene) === -1) {
      fallas.push('no contiene "' + esperado.contiene + '"');
    }
    if (plano.indexOf(String.fromCharCode(0)) !== -1 ||
        plano.indexOf('u0000') !== -1) {
      fallas.push('hay bytes NUL en el resultado (mojibake UTF-16)');
    }
  }
  if (esperado.columnasEsperadas !== undefined && matriz.length) {
    if (matriz[0].length !== esperado.columnasEsperadas) {
      fallas.push('esperaba ' + esperado.columnasEsperadas + ' columnas, hubo ' + matriz[0].length);
    }
  }
  return fallas;
}

function correr() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });

  console.log('');
  console.log('  Fixtures en: ' + DIR);
  console.log('  SheetJS: ' + (excel.tieneSheetJs() ? 'presente' : 'AUSENTE'));
  console.log('');
  console.log('  ' + 'caso'.padEnd(26) + 'formato'.padEnd(16) + 'lectura'.padEnd(12) + 'estado');
  console.log('  ' + '-'.repeat(74));

  let fallidos = 0;

  for (const caso of casos) {
    const fallas = [];
    let detectado = '—', lectura = '—';
    let ruta;

    try {
      ruta = caso.build();
    } catch (e) {
      console.log('  ' + caso.n.padEnd(26) + 'no se pudo construir la fixture: ' + e.message);
      fallidos++;
      continue;
    }

    // --- deteccion ---
    const esperaThrow = caso.formato && caso.formato.throws !== undefined;
    try {
      detectado = excel.formatoReal(ruta);
      if (esperaThrow) {
        fallas.push('esperaba que abortara con "' + caso.formato.throws + '", devolvio "' + detectado + '"');
      } else {
        const ok = Array.isArray(caso.formato)
          ? caso.formato.indexOf(detectado) !== -1
          : caso.formato === detectado;
        if (!ok) fallas.push('formato "' + detectado + '" != "' + caso.formato + '"');
      }
    } catch (e) {
      detectado = 'THROW';
      if (!esperaThrow) {
        fallas.push('abortó inesperadamente: ' + e.message.split(os.EOL)[0]);
      } else if (e.message.indexOf(caso.formato.throws) === -1) {
        fallas.push('abortó, pero el mensaje no menciona "' + caso.formato.throws + '": ' + e.message);
      }
    }

    // --- lectura completa ---
    if (caso.lee && !esperaThrow) {
      try {
        const matriz = excel.leerPlanilla(ruta);
        lectura = matriz.length + ' filas';
        fallas.push.apply(fallas, chequearLectura(matriz, caso.lee));
      } catch (e) {
        lectura = 'THROW';
        fallas.push('leerPlanilla abortó: ' + e.message.split(os.EOL)[0]);
      }
    } else if (esperaThrow) {
      lectura = 'n/a';
    }

    const estado = fallas.length ? 'FALLA' : 'ok';
    if (fallas.length) fallidos++;
    console.log('  ' + caso.n.padEnd(26) + String(detectado).padEnd(16) +
                String(lectura).padEnd(12) + estado);
    if (fallas.length) {
      console.log('      ' + caso.desc);
      fallas.forEach(f => console.log('      -> ' + f));
    }
  }

  console.log('');
  if (fallidos) {
    console.log('  >>> ' + fallidos + ' de ' + casos.length + ' FALLARON');
    process.exit(1);
  }
  console.log('  >>> FORMATOS OK — ' + casos.length + '/' + casos.length);
  console.log('');
}

correr();
