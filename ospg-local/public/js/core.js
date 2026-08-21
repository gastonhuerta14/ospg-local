/**
 * core.js — Reemplazo de google.script.run.
 *
 * LA CLAVE DE TODA LA MIGRACIÓN DEL FRONT ESTÁ ACÁ: `llamar()` conserva
 * exactamente la misma firma y el mismo contrato de promesa que tenía la
 * versión de GAS. Por eso `js/tabla.js`, `js/revision.js` y `js/ingesta.js`
 * siguen llamando `await llamar('apiGetMaestro')` sin una sola modificación.
 *
 * Antes:  google.script.run.withSuccessHandler(...).apiGetMaestro()
 * Ahora:  fetch('/api/maestro') → misma envoltura {ok, data, error}
 *
 * Cambiaste el transporte, no la aplicación.
 */

const RUTAS_API = {
  apiGetEstado:        { metodo: 'GET',  url: '/api/estado' },
  apiGetMaestro:       { metodo: 'GET',  url: '/api/maestro' },
  apiGetRevision:      { metodo: 'GET',  url: '/api/revision' },
  apiGetDetalle:       { metodo: 'GET',  url: '/api/detalle',   query: ['clave'] },
  apiIngestarArchivo:  { metodo: 'POST', url: '/api/ingestar',  body: ['indice'] },
  apiConstruirMaestro: { metodo: 'POST', url: '/api/cruzar' },
  apiGuardarDecision:  { metodo: 'POST', url: '/api/decision',  body: ['sistemaA','idA','sistemaB','idB','decision'] },
  apiAgregarSinonimo:  { metodo: 'POST', url: '/api/sinonimo',  body: ['variante','monodroga'] }
};

window.PERIODO = '';
window.USUARIO = null;

async function llamar(fn, ...args) {
  const def = RUTAS_API[fn];
  if (!def) throw { code: 'RUTA', message: 'No hay endpoint definido para ' + fn };

  let url = def.url;
  const opciones = { method: def.metodo, headers: { 'Accept': 'application/json' } };

  if (def.metodo === 'GET' && def.query) {
    const p = new URLSearchParams();
    def.query.forEach((nombre, i) => { if (args[i] !== undefined) p.set(nombre, args[i]); });
    url += '?' + p.toString();
  } else if (def.metodo === 'POST') {
    const cuerpo = {};
    (def.body || []).forEach((nombre, i) => { cuerpo[nombre] = args[i]; });
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  let resp;
  try {
    resp = await fetch(url, opciones);
  } catch (e) {
    // El servidor no está levantado: el error más común en desarrollo, y el que
    // más tiempo hace perder si se muestra como un "Error desconocido".
    throw { code: 'RED', message: 'No hay respuesta del servidor. ¿Está corriendo `node server.js`?' };
  }

  let json;
  try { json = await resp.json(); }
  catch (e) { throw { code: 'PARSE', message: 'El servidor respondió algo que no es JSON (HTTP ' + resp.status + ').' }; }

  if (!json.ok) throw json.error || { code: 'ERR', message: 'Error sin detalle (HTTP ' + resp.status + ').' };
  return json.data;
}

/* ------------------------------------------------------------------ UI --- */

function bannerError(msg, code, reintentar) {
  $('#app-content').html(
    '<div class="alert alert-danger m-4">' +
      '<strong>' + (code || 'ERROR') + '</strong> ' + $('<div>').text(msg || '').html() +
      (reintentar ? ' <button class="btn btn-sm btn-outline-danger ms-2" id="btnReintentar">Reintentar</button>' : '') +
    '</div>');
  if (reintentar) $('#btnReintentar').on('click', reintentar);
}

const VISTAS = {
  'nav-dashboard':   () => cargarDashboard(),
  'nav-ingesta':     () => cargarPanelIngesta(),
  'nav-revision':    () => cargarRevision(),
  'nav-diccionario': () => cargarDiccionario()
};

function irA(id) {
  $('.nav-link').removeClass('active');
  $('#' + id).addClass('active');
  const fn = VISTAS[id] || VISTAS['nav-dashboard'];
  try { fn(); } catch (e) { bannerError(e.message, 'UI', () => irA(id)); }
}

function cargarDiccionario() {
  $('#app-content').html(
    '<div class="card border-0 shadow-sm p-3 mx-auto" style="max-width:640px;">' +
      '<h5>Diccionario de sinónimos</h5>' +
      '<p class="text-muted small">Una entrada manual siempre le gana a lo que el sistema dedujo solo. ' +
      'El archivo está en <code>data/control/DIC_SINONIMOS.csv</code>: también podés editarlo con Excel.</p>' +
      '<div class="row g-2">' +
        '<div class="col-5"><input id="dicVariante" class="form-control form-control-sm" placeholder="Variante (ej. MABTHERA)"></div>' +
        '<div class="col-5"><input id="dicMonodroga" class="form-control form-control-sm" placeholder="Monodroga (ej. RITUXIMAB)"></div>' +
        '<div class="col-2"><button id="dicGuardar" class="btn btn-sm btn-primary w-100">Agregar</button></div>' +
      '</div><div id="dicMsg" class="mt-2 small"></div>' +
    '</div>');

  $('#dicGuardar').on('click', async function () {
    const v = $('#dicVariante').val(), m = $('#dicMonodroga').val();
    if (!v || !m) return $('#dicMsg').html('<span class="text-danger">Completá las dos columnas.</span>');
    $(this).prop('disabled', true);
    try {
      await llamar('apiAgregarSinonimo', v, m);
      $('#dicMsg').html('<span class="text-success">Guardado. Se aplica en la próxima ingesta.</span>');
      $('#dicVariante,#dicMonodroga').val('');
    } catch (e) {
      $('#dicMsg').html('<span class="text-danger">' + $('<div>').text(e.message).html() + '</span>');
    } finally { $(this).prop('disabled', false); }
  });
}

$(document).ready(async function () {
  $('.nav-link').on('click', function (e) { e.preventDefault(); irA(this.id); });

  try {
    const estado = await llamar('apiGetEstado');
    window.PERIODO = estado.periodo;
    window.USUARIO = estado.usuario;

    $('#userEmail').text(estado.usuario.email + ' (' + estado.usuario.rol + ')');
    $('#periodoActual').text(estado.periodo);
    $('#count-revision').text(estado.enRevision || 0);
    $('#btnActualizar').on('click', ejecutarIngesta);

    irA(estado.gold.existe ? 'nav-dashboard' : 'nav-ingesta');
  } catch (e) {
    $('#userEmail').text('sin conexión');
    bannerError(e.message, e.code, () => location.reload());
  }
});
