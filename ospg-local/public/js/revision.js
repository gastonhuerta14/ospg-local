
/**
 * js_revision.html — Cola de revisión humana.
 *
 * ESTE ARCHIVO NO ESTABA EN EL PROYECTO que me pasaste, pero `index.html` lo
 * incluye con `<?!= include('js_revision') ?>`. Si efectivamente falta,
 * `HtmlService.createHtmlOutputFromFile('js_revision')` lanza excepción dentro
 * de `doGet()` y la Web App NO CARGA — pantalla de error, no dashboard.
 *
 * Cada decisión se guarda contra la identidad estable de las dos puntas
 * (sistema + id), nunca contra una clave derivada del parser, así sobrevive a
 * cualquier cambio futuro del motor de normalización.
 */

var REVISION = [];

async function cargarRevision() {
  $('#app-content').html('<div class="text-center mt-5"><div class="spinner-border text-warning"></div><p class="mt-2 text-muted">Cargando cola de revisión…</p></div>');
  try {
    REVISION = await llamar('apiGetRevision');
    renderizarRevision();
  } catch (e) {
    $('#app-content').html('<div class="alert alert-danger m-4"><strong>' +
      (e.code || 'ERROR') + '</strong> ' + escapar(e.message) + '</div>');
  }
}

function renderizarRevision() {
  $('#count-revision').text(REVISION.length);

  if (!REVISION.length) {
    $('#app-content').html(
      '<div class="card mx-auto mt-5 border-0 shadow-sm" style="max-width:460px;">' +
      '<div class="card-body text-center">' +
      '<h5 class="card-title">Nada pendiente de revisión</h5>' +
      '<p class="text-muted mb-0">El motor no encontró pares dudosos en la última corrida. ' +
      'Las decisiones que ya tomaste quedan guardadas y se aplican solas el mes que viene.</p>' +
      '</div></div>');
    return;
  }

  var html =
    '<div class="alert alert-light border d-flex justify-content-between align-items-center">' +
      '<div><strong>' + REVISION.length + ' pares dudosos.</strong> ' +
      '<span class="text-muted">Ordenados de más a menos probable. Cada decisión se guarda y no vuelve a preguntarse.</span></div>' +
    '</div><div id="listaRevision">';

  REVISION.slice().sort(function (a, b) { return b.score - a.score; }).forEach(function (x, i) {
    html +=
      '<div class="card border-0 shadow-sm mb-3" id="rev-' + i + '">' +
        '<div class="card-body">' +
          '<div class="d-flex justify-content-between align-items-start mb-2">' +
            '<span class="badge bg-light text-secondary">' + escapar(x.motivo) + '</span>' +
            '<span class="small text-muted">score ' + escapar(x.score) +
              ' · base ' + escapar(x.base) + ' · umbral ' + escapar(x.umbralAplicado) + '</span>' +
          '</div>' +
          '<div class="row g-3">' +
            colRevision('SMC', x.smc, 'var(--serie-smc)') +
            colRevision('OSPG', x.ospg, 'var(--serie-ospg)') +
          '</div>' +
          '<div class="mt-3 text-end">' +
            '<button class="btn btn-sm btn-outline-secondary me-2" onclick="decidir(' + i + ",'NO_UNIR')\">✕ No es el mismo</button>" +
            '<button class="btn btn-sm btn-success" onclick="decidir(' + i + ",'UNIR')\">✓ Unir</button>" +
          '</div>' +
        '</div>' +
      '</div>';
  });

  $('#app-content').html(html + '</div>');
}

function colRevision(nombre, p, color) {
  return '<div class="col-md-6"><div class="border rounded p-2 h-100">' +
    '<div class="small text-secondary"><span style="color:' + color + ';">●</span> ' + nombre +
      ' · ' + escapar(p.sistema) + ' · ' + escapar(p.fuente) + ' fila ' + escapar(p.fila) + '</div>' +
    '<div class="font-monospace mt-1" style="font-size:.85rem;">' + escapar(p.descripcionRaw) + '</div>' +
    '<div class="small text-muted mt-1">' + escapar(p.principioActivo) +
      ' · ' + escapar(p.discriminante || 'sin discriminante') +
      ' · ' + escapar(p.tipo) + '</div>' +
    '</div></div>';
}

async function decidir(indice, decision) {
  var ordenados = REVISION.slice().sort(function (a, b) { return b.score - a.score; });
  var x = ordenados[indice];
  if (!x) return;

  var $card = $('#rev-' + indice);
  $card.css('opacity', .5).find('button').prop('disabled', true);

  try {
    await llamar('apiGuardarDecision', x.smc.sistema, x.smc.id, x.ospg.sistema, x.ospg.id, decision);

    $card.replaceWith(
      '<div class="alert alert-' + (decision === 'UNIR' ? 'success' : 'secondary') + ' py-2 mb-3">' +
      (decision === 'UNIR' ? '✓ Unidos' : '✕ Marcados como distintos') + ': ' +
      escapar(x.smc.principioActivo) + ' — la decisión ya quedó guardada.</div>');

    REVISION = REVISION.filter(function (r) {
      return !(r.smc.id === x.smc.id && r.ospg.id === x.ospg.id);
    });
    $('#count-revision').text(REVISION.length);
  } catch (e) {
    $card.css('opacity', 1).find('button').prop('disabled', false);
    $card.find('.card-body').prepend(
      '<div class="alert alert-danger py-2">No se pudo guardar: ' + escapar(e.message) + '</div>');
  }
}

