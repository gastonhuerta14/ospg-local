'use strict';
/**
 * engineLoader.js — Carga el motor SIN MODIFICAR NI UNA LÍNEA de engine/.
 *
 * Por qué no `require()` de cada archivo: en GAS todos los `.gs` comparten un
 * único scope global; en Node cada archivo es un módulo aislado. Portar el motor
 * a CommonJS obligaría a agregar `module.exports` y `require` en cada archivo, y
 * a partir de ahí el código de GAS y el de Node empiezan a divergir: dos copias
 * que hay que auditar dos veces.
 *
 * `node:vm` reproduce la semántica de GAS exactamente: un contexto, varios
 * scripts, scope compartido. Los archivos de engine/ quedan byte a byte iguales
 * a los del proyecto de Apps Script, así que se pueden seguir corriendo en los
 * dos lados mientras se decide el despliegue final.
 *
 * Lo único que cambia entre GAS y local es lo que se INYECTA en el contexto.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { crearShims } = require('./gasShims');
const { crearStore } = require('./adapters/store');
const excel = require('./adapters/excel');

/** Orden de carga. Sólo importa que config vaya primero. */
const ARCHIVOS_MOTOR = [
  '20_Texto.js',
  '21_Parser.js',
  '22_Diccionario.js',
  '23_Fuzzy.js',
  '31_Precios.js',
  '30_Cruce.js',
  '11_Ingesta.js',
  '32_Maestro.js',
  '90_Auditoria.js'
];

function cargarMotor(opciones) {
  const raiz = opciones.raiz;
  const dirConfig = path.join(raiz, 'config');
  const dirMotor = path.join(raiz, 'engine');
  const dirDatos = opciones.dirDatos || path.join(raiz, 'data');

  const dirControl = path.join(dirDatos, 'control');
  const dirSalida = path.join(dirDatos, 'salida');
  const dirEntrada = path.join(dirDatos, 'entrada');

  const shims = crearShims({ dirControl: dirControl, usuario: opciones.usuario });
  const store = crearStore(dirSalida);

  const sandbox = {
    console,
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error,
    Map, Set, isNaN, parseInt, parseFloat, Intl,

    // --- servicios de Google, versión local -------------------------------
    SpreadsheetApp: shims.SpreadsheetApp,
    Utilities: shims.Utilities,
    LockService: shims.LockService,
    Session: shims.Session,
    Logger: shims.Logger,
    MimeType: shims.MimeType,

    // --- I/O que en GAS vivía en 10_DriveIO.gs y 40_Store.gs --------------
    // Se inyectan con la MISMA firma, para que 11_Ingesta.js no cambie.
    guardarJson_: (nombre, obj) => store.guardarJson(nombre, obj),
    leerJson_: (nombre) => store.leerJson(nombre),

    localizarArchivo_: (fuente) => {
      const dirPeriodo = path.join(dirEntrada, CFGLocal.PERIODO);
      return excel.localizarArchivo(dirPeriodo, fuente.patron);
    },
    // En local el "fileId" ES la ruta del archivo. El motor sólo lo pasa de
    // una función a otra, nunca lo interpreta.
    leerExcelConvertido_: (rutaArchivo) => excel.leerPlanilla(rutaArchivo),
    DriveApp: {
      getFileById: (rutaArchivo) => ({
        getName: () => path.basename(rutaArchivo),
        getId: () => rutaArchivo
      })
    }
  };

  const ctx = vm.createContext(sandbox);

  // config primero: define CFG y FUENTES para todo el resto.
  ejecutar(ctx, path.join(dirConfig, '00_Config.js'));
  const CFGLocal = vm.runInContext('CFG', ctx);

  ARCHIVOS_MOTOR.forEach(nombre => ejecutar(ctx, path.join(dirMotor, nombre)));

  return {
    ctx,
    store,
    shims,
    CFG: CFGLocal,
    FUENTES: vm.runInContext('FUENTES', ctx),
    /** Ejecuta una expresión en el contexto del motor. */
    eval: (codigo) => vm.runInContext(codigo, ctx),
    /** Llama a una función del motor con argumentos del host. */
    llamar: (nombreFn, ...args) => {
      const fn = vm.runInContext(nombreFn, ctx);
      if (typeof fn !== 'function') throw new Error('El motor no expone la función ' + nombreFn);
      return fn(...args);
    }
  };
}

function ejecutar(ctx, archivo) {
  if (!fs.existsSync(archivo)) throw new Error('Falta un archivo del motor: ' + archivo);
  let codigo = fs.readFileSync(archivo, 'utf8');
  // Los .html de GAS traen <script>; los .gs no. Se tolera por si copian uno.
  codigo = codigo.replace(/^\s*<script[^>]*>/i, '').replace(/<\/script>\s*$/i, '');
  try {
    vm.runInContext(codigo, ctx, { filename: path.basename(archivo) });
  } catch (e) {
    throw new Error('Error cargando ' + path.basename(archivo) + ': ' + e.message);
  }
}

module.exports = { cargarMotor, ARCHIVOS_MOTOR };
