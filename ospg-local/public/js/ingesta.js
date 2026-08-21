
/**
 * js_ingesta.html — Panel de ingesta y orquestación de las 7 llamadas.
 *
 * Correcciones sobre la versión revisada:
 *  1. `nav-ingesta` no tenía vista propia (el router mandaba todo al dashboard).
 *  2. No se mostraba el diagnóstico de columnas. Si a un archivo le falta la
 *     columna de precio o de cantidad, TODO lo que sigue es ruido y el usuario
 *     tiene que enterarse antes de mirar un solo número.
 *  3. No se mostraba el resultado de QA ni el aviso de recorte por tiempo.
 *     Un tablero que oculta lo que no pudo hacer enseña a confiar de más.
 */

function cargarPanelIngesta() {
  var cards = '';
  for (var i = 0; i < 6; i++) {
    cards +=
      '<div class="col-md-4 mb-3"><div class="card border-0 shadow-sm h-100" id="card-' + i + '">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-1">' +
            '<span id="dot-' + i + '" class="me-2" style="color:var(--text-muted);">●</span>' +
            '<strong id="titulo-' + i + '">Archivo ' + (i + 1) + '</strong>' +
          '</div>' +
          '<div id="estado-' + i + '" class="small text-muted">Pendiente</div>' +
          '<div id="detalle-' + i + '" class="small mt-2"></div>' +
        '</div>' +
      '</div></div>';
  }

  var puedeEditar = !window.USUARIO || window.USUARIO.rol === 'editor';

  $('#app-content').html(
    '<div class="d-flex justify-content-between align-items-center mb-3">' +
      '<h5 class="mb-0">Ingesta de archivos · ' + (window.PERIODO || '') + '</h5>' +
      '<button class="btn btn-primary btn-sm" id="btnCorrer"' +
        (puedeEditar ? '' : ' disabled title="Tu rol es lector."') + '>Procesar los 6 archivos</button>' +
    '</div>' +
    '<div class="row">' + cards + '</div>' +
    '<div id="panel-cruce" class="mt-3"></div>');

  $('#btnCorrer').on('click', ejecutarIngesta);
}

function pintarEstado(i, estado, datos) {
  var colores = { LEYENDO: 'var(--serie-smc)', OK: 'var(--status-good)',
                  ERROR: 'var(--status-critical)', FALTANTE: 'var(--status-warning)' };
  var iconos = { LEYENDO: '◐', OK: '✓', ERROR: '✕', FALTANTE: '⚠' };
  $('#dot-' + i).css('color', colores[estado] || 'var(--text-muted)').text(iconos[estado] || '●');

  if (estado === 'LEYENDO') { $('#estado-' + i).text('Leyendo…'); return; }
  if (estado === 'ERROR') {
    $('#estado-' + i).html('<span style="color:var(--status-critical);">Error</span>');
    $('#detalle-' + i).html('<div class="text-danger">' + esc(datos && datos.message) + '</div>');
    return;
  }
  if (estado === 'FALTANTE') {
    $('#estado-' + i).text('No se encontró el archivo');
    $('#detalle-' + i).html('<span class="text-muted">Se conservan los datos de la corrida anterior.</span>');
    return;
  }

  $('#titulo-' + i).text(datos.sistema + ' · ' + (datos.id || ''));
  $('#estado-' + i).text(datos.registrosValidos + ' de ' + datos.filasLeidas +
                         ' filas · ' + Math.round((datos.duracionMs || 0) / 100) / 10 + ' s');

  var d = '';
  var faltantes = datos.columnasNoEncontradas || [];
  var criticas = faltantes.filter(function (c) { return c === 'precio' || c === 'cant' || c === 'desc'; });
  if (criticas.length) {
    d += '<div style="color:var(--status-critical);">⚠ Faltan columnas críticas: <strong>' +
         esc(criticas.join(', ')) + '</strong> — los importes de este archivo no son confiables.</div>';
  } else if (faltantes.length) {
    d += '<div class="text-muted">Sin columna: ' + esc(faltantes.join(', ')) + '</div>';
  }
  if (datos.diccionario) {
    d += '<div class="text-muted">Diccionario ' + datos.diccionario.previos + ' → ' +
         datos.diccionario.total + ' (aprendidos ' + datos.diccionario.aprendidos + ')</div>';
  }
  if (datos.reResueltos) d += '<div class="text-muted">Re-resueltos: ' + datos.reResueltos + '</div>';
  if (datos.conflictos) {
    d += '<div style="color:var(--status-warning);">⚠ ' + datos.conflictos +
         ' conflicto(s) de sinónimos → hoja DIC_CONFLICTOS</div>';
  }
  $('#detalle-' + i).html(d);
}

function esc(s) { return $('<div>').text(s === null || s === undefined ? '' : String(s)).html(); }

async function ejecutarIngesta() {
  if ($('#card-0').length === 0) cargarPanelIngesta();
  $('#btnCorrer').prop('disabled', true).text('Procesando…');
  $('#panel-cruce').html('');

  for (var i = 0; i < 6; i++) {
    pintarEstado(i, 'LEYENDO');
    try {
      var r = await llamar('apiIngestarArchivo', i);
      pintarEstado(i, r.estado === 'OK' ? 'OK' : 'FALTANTE', r);
    } catch (e) {
      pintarEstado(i, 'ERROR', e);
      if (e.code === 'BUSY' || e.code === 'AUTH') {
        $('#btnCorrer').prop('disabled', false).text('Procesar los 6 archivos');
        return;
      }
      // Un archivo que falla NO aborta los otros cinco.
    }
  }

  $('#panel-cruce').html('<div class="text-primary">⚙️ Cruzando…</div>');
  try {
    var res = await llamar('apiConstruirMaestro');
    $('#count-revision').text(res.enRevision);

    var html = '<div class="card border-0 shadow-sm p-3">' +
      '<strong>Cruce finalizado:</strong> ' + res.articulos + ' artículos · ' +
      res.enRevision + ' en revisión';

    if (res.truncado) {
      html += '<div class="alert alert-warning mt-2 mb-0 py-2">⚠ El motor cortó por presupuesto de tiempo. ' +
              'Quedaron <strong>' + res.noProcesados + '</strong> artículos sin comparar. ' +
              'Volvé a ejecutar el cruce para continuar.</div>';
    }
    if (res.qa && res.qa.length) {
      html += '<table class="table table-sm mt-3 mb-0"><tbody>';
      res.qa.forEach(function (c) {
        html += '<tr><td>' + (c.ok ? '✓' : '<span style="color:var(--status-critical);">✕</span>') +
                '</td><td>' + esc(c.check) + '</td><td class="text-end text-muted">' + esc(c.delta) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    $('#panel-cruce').html(html + '</div>');

    setTimeout(function () { irA('nav-dashboard'); }, 1800);
  } catch (e) {
    $('#panel-cruce').html('<div class="alert alert-danger">Error en el cruce: ' + esc(e.message) + '</div>');
  } finally {
    $('#btnCorrer').prop('disabled', false).text('Procesar los 6 archivos');
  }
}

