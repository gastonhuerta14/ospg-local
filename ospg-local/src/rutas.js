'use strict';
/**
 * rutas.js — Tabla de endpoints, independiente de Express.
 *
 * La lógica de cada ruta vive acá y no en server.js. Así se puede testear sin
 * levantar un servidor, y si mañana cambian Express por Fastify o por el http
 * de Node, se reemplaza el montaje y esta tabla queda igual.
 *
 * Todas las respuestas usan la MISMA envoltura que devolvía google.script.run:
 *   { ok: true,  data: ..., error: null }
 *   { ok: false, data: null, error: { code, message } }
 * El frontend sólo cambia el transporte, no el contrato.
 */

function definirRutas(api) {
  return [
    { metodo: 'get',  ruta: '/api/estado',    handler: () => api.estado() },
    { metodo: 'get',  ruta: '/api/maestro',   handler: () => api.getMaestro() },
    { metodo: 'get',  ruta: '/api/revision',  handler: () => api.getRevision() },

    { metodo: 'get',  ruta: '/api/detalle',   handler: (q) => api.getDetalle(q.clave) },

    { metodo: 'post', ruta: '/api/ingestar',  handler: (q, body) => {
        const i = Number(body.indice);
        if (!Number.isInteger(i)) { const e = new Error('Falta el índice de fuente.'); e.code = 'RANGO'; throw e; }
        return api.ingestarArchivo(i);
      } },

    { metodo: 'post', ruta: '/api/cruzar',    handler: () => api.construirMaestro() },

    { metodo: 'post', ruta: '/api/decision',  handler: (q, b) =>
        api.guardarDecision(b.sistemaA, b.idA, b.sistemaB, b.idB, b.decision) },

    { metodo: 'post', ruta: '/api/sinonimo',  handler: (q, b) =>
        api.agregarSinonimo(b.variante, b.monodroga) },

    { metodo: 'post', ruta: '/api/auditoria', handler: () => api.auditoria() }
  ];
}

/** Envuelve un handler: normaliza la respuesta y traduce el código de error. */
function ejecutar(handler, query, body) {
  try {
    return { estadoHttp: 200, cuerpo: { ok: true, data: handler(query || {}, body || {}), error: null } };
  } catch (e) {
    const code = e.code || 'ERR';
    const estadoHttp = code === 'AUTH' ? 403
                     : code === 'BUSY' ? 409
                     : code === 'RANGO' ? 400
                     : code === 'SIN_DATOS' ? 404
                     : 500;
    return { estadoHttp, cuerpo: { ok: false, data: null, error: { code, message: e.message } } };
  }
}

module.exports = { definirRutas, ejecutar };
