'use strict';
/**
 * server.js — Servidor local. Reemplaza a doGet() y a google.script.run.
 *
 * Es deliberadamente delgado: monta la tabla de src/rutas.js y sirve public/.
 * Toda la lógica está debajo, en src/api.js y engine/, que se testean sin
 * levantar el servidor.
 *
 *   node server.js            → http://localhost:3000
 *   PORT=4000 node server.js  → otro puerto
 */

const path = require('node:path');
const express = require('express');

const { crearApi } = require('./src/api');
const { definirRutas, ejecutar } = require('./src/rutas');

const PORT = Number(process.env.PORT || 3000);
const USUARIO = process.env.OSPG_USUARIO || 'local@ospg';

const app = express();
app.use(express.json({ limit: '2mb' }));

// Sólo escucha en loopback: nadie de la red puede entrar mientras desarrollás.
const HOST = process.env.HOST || '127.0.0.1';

let api;
try {
  api = crearApi({ raiz: __dirname, usuario: USUARIO });
  console.log('Motor cargado. Período: ' + api.motor.CFG.PERIODO +
              ' · fuentes: ' + api.motor.FUENTES.length);
} catch (e) {
  console.error('\n✕ No se pudo cargar el motor:\n  ' + e.message + '\n');
  process.exit(1);
}

definirRutas(api).forEach(r => {
  app[r.metodo](r.ruta, (req, res) => {
    const t0 = Date.now();
    const { estadoHttp, cuerpo } = ejecutar(r.handler, req.query, req.body);
    if (!cuerpo.ok) console.warn('  ' + r.ruta + ' → ' + cuerpo.error.code + ': ' + cuerpo.error.message);
    else console.log('  ' + r.ruta + ' → 200 (' + (Date.now() - t0) + 'ms)');
    res.status(estadoHttp).json(cuerpo);
  });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Cualquier otra ruta cae en la SPA.
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, HOST, () => {
  console.log('\n  OSPG · Cruce de Compras');
  console.log('  http://localhost:' + PORT);
  console.log('  usuario: ' + USUARIO + '\n');
});
