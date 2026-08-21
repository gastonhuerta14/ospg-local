
/**
 * js_tabla.html — Tabla Maestra + drill-down. VERSIÓN CORREGIDA.
 *
 * Corrección principal: las columnas usaban `data: 'smc.unidades'` y las filas
 * SIN_MATCH tienen `smc: null`. DataTables corta con
 * "Requested unknown parameter 'smc.unidades' for row N" y la tabla NO RENDERIZA.
 * Como el maestro siempre incluye filas de un solo lado, esto rompía la vista
 * principal en cuanto había un artículo sin contraparte.
 *
 * Ahora cada columna accede con una función que tolera el lado nulo, y el
 * ordenamiento usa el valor numérico crudo (antes ordenaba el texto formateado).
 */

var MAESTRO = [];
var TABLA = null;

var fmtMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
var fmtNumero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

function guion() { return '<span class="text-muted">—</span>'; }

/** null => "—". El cero SÍ se muestra: "sin dato" y "cero" no son lo mismo. */
function celdaNum(v, fmt) {
  return (v === null || v === undefined) ? guion() : fmt.format(v);
}

/** Accesor seguro: devuelve null en vez de explotar cuando el lado no existe. */
function lado(row, cual, campo) {
  return row[cual] ? (row[cual][campo] === undefined ? null : row[cual][campo]) : null;
}

/** Para ordenar: los nulos van SIEMPRE al final, no al principio. */
function paraOrden(v) { return (v === null || v === undefined) ? -Infinity : v; }

async function cargarDashboard() {
  $('#app-content').html('<div class="text-center mt-5"><div class="spinner-border text-primary" role="status"></div><p class="mt-2 text-muted">Cargando maestro…</p></div>');
  try {
    MAESTRO = await llamar('apiGetMaestro');
    if (!MAESTRO || !MAESTRO.length) return renderVacio();
    renderizarTabla(MAESTRO);
  } catch (e) {
    $('#app-content').html('<div class="alert alert-danger m-4"><strong>' +
      (e.code || 'ERROR') + '</strong> ' + escapar(e.message) +
      ' <button class="btn btn-sm btn-outline-danger ms-2" onclick="cargarDashboard()">Reintentar</button></div>');
  }
}

function renderVacio() {
  $('#app-content').html(
    '<div class="card mx-auto mt-5 border-0 shadow-sm" style="max-width:420px;">' +
    '<div class="card-body text-center">' +
    '<h5 class="card-title">Sin datos para el período</h5>' +
    '<p class="text-muted">Todavía no se ingirieron los archivos de Drive para ' + escapar(window.PERIODO || 'el período') + '.</p>' +
    '<button class="btn btn-primary" id="btnProcesar">Procesar archivos</button>' +
    '</div></div>');
  $('#btnProcesar').on('click', ejecutarIngesta);
}

function escapar(s) {
  return $('<div>').text(s === null || s === undefined ? '' : String(s)).html();
}

function kpis(filas) {
  const comparables = filas.filter(f => f.smc && f.ospg);
  const ahorro = filas.reduce((a, f) => a + (f.ahorro || 0), 0);
  const cob = filas.length ? Math.round(comparables.length / filas.length * 100) : 0;
  const tile = (label, valor, sub) =>
    '<div class="col"><div class="card border-0 shadow-sm h-100"><div class="card-body">' +
    '<div class="text-secondary" style="font-size:.8rem;">' + label + '</div>' +
    '<div style="font-size:1.6rem;font-weight:600;">' + valor + '</div>' +
    '<div class="text-muted" style="font-size:.75rem;">' + (sub || '&nbsp;') + '</div>' +
    '</div></div></div>';
  return '<div class="row row-cols-4 g-3 mb-3">' +
    tile('Capacidad de ahorro', fmtMoneda.format(ahorro), 'sobre lo ya comprado') +
    tile('Artículos únicos', fmtNumero.format(filas.length), '') +
    tile('Comparables', fmtNumero.format(comparables.length), cob + '% de cobertura') +
    tile('En revisión', '<span id="kpi-revision">—</span>', 'pendientes de decisión') +
    '</div>';
}

function renderizarTabla(filas) {
  $('#app-content').html(
    kpis(filas) +
    '<div class="card border-0 shadow-sm p-3 mb-3">' +
      '<div class="row g-2 align-items-center">' +
        '<div class="col-md-4"><input id="fBuscar" class="form-control form-control-sm" placeholder="🔍 Buscar droga, marca o proveedor…"></div>' +
        '<div class="col-md-2"><select id="fTipo" class="form-select form-select-sm"><option value="">Todos los tipos</option><option>MEDICAMENTO</option><option>INSUMO</option><option>INDETERMINADO</option></select></div>' +
        '<div class="col-md-3"><select id="fProveedor" class="form-select form-select-sm"><option value="">Todos los proveedores</option></select></div>' +
        '<div class="col-md-3 text-end"><div class="form-check form-check-inline">' +
          '<input class="form-check-input" type="checkbox" id="fComparables"><label class="form-check-label small" for="fComparables">Sólo comparables</label>' +
        '</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="card border-0 shadow-sm p-3">' +
      '<table id="tablaMaestra" class="table table-hover align-middle" style="width:100%;font-variant-numeric:tabular-nums;">' +
      '<thead class="table-light"><tr>' +
        '<th>Droga</th><th>Potencia / medida</th><th>Presentación</th>' +
        '<th class="text-end">Un. SMC</th><th class="text-end">$/un. SMC</th>' +
        '<th class="text-end">Un. OSPG</th><th class="text-end">$/un. OSPG</th>' +
        '<th class="text-center">Dif. %</th><th class="text-end">Ahorro</th>' +
      '</tr></thead><tbody></tbody></table>' +
    '</div>' +
    '<div class="offcanvas offcanvas-end" tabindex="-1" id="panelDetalle" style="width:640px;">' +
      '<div class="offcanvas-header border-bottom"><h5 class="offcanvas-title" id="detalleTitulo">Detalle</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Cerrar"></button></div>' +
      '<div class="offcanvas-body" id="detalleCuerpo"></div>' +
    '</div>');

  const provs = Array.from(new Set(filas.flatMap(f =>
    [lado(f, 'smc', 'proveedor'), lado(f, 'ospg', 'proveedor')]).filter(Boolean))).sort();
  provs.forEach(p => $('#fProveedor').append($('<option>').text(p)));

  TABLA = $('#tablaMaestra').DataTable({
    data: filas,
    deferRender: true,
    pageLength: 50,
    order: [[8, 'desc']],
    language: { url: 'https://cdn.datatables.net/plug-ins/1.13.5/i18n/es-AR.json' },
    columns: [
      { data: 'droga', render: function (d, t, row) {
          if (t !== 'display') return d || '';
          const badge = row.nivelMatch === 'SIN_MATCH'
            ? '<span class="badge bg-secondary-subtle text-secondary">sin contraparte</span>'
            : '<span class="badge bg-light text-secondary">' + escapar(row.nivelMatch) + '</span>';
          const amb = (row.flags || []).indexOf('ENVASE_AMBIGUO') >= 0
            ? ' <span class="badge" style="background:var(--status-warning);color:#000;" title="Tamaño de envase ambiguo: el ahorro no se calcula">envase ambiguo</span>' : '';
          return '<strong>' + escapar(d) + '</strong><br><small class="text-muted">' +
                 escapar(row.tipo || '') + ' · </small>' + badge + amb;
        } },
      { data: 'potencia', render: function (d, t) { return t === 'display' ? (d ? escapar(d) : guion()) : (d || ''); } },
      { data: 'presentacion', render: function (d, t) { return t === 'display' ? (d ? escapar(d) : guion()) : (d || ''); } },

      { data: function (r) { return lado(r, 'smc', 'unidades'); },
        className: 'text-end',
        render: function (d, t) { return t === 'display' ? celdaNum(d, fmtNumero) : paraOrden(d); } },

      { data: function (r) { return lado(r, 'smc', 'precioUnitario'); },
        className: 'text-end',
        render: function (d, t) {
          if (t !== 'display') return paraOrden(d);
          return d === null ? guion() : '<span style="color:var(--serie-smc);" aria-label="SMC">●</span> ' + fmtMoneda.format(d);
        } },

      { data: function (r) { return lado(r, 'ospg', 'unidades'); },
        className: 'text-end',
        render: function (d, t) { return t === 'display' ? celdaNum(d, fmtNumero) : paraOrden(d); } },

      { data: function (r) { return lado(r, 'ospg', 'precioUnitario'); },
        className: 'text-end',
        render: function (d, t) {
          if (t !== 'display') return paraOrden(d);
          return d === null ? guion() : '<span style="color:var(--serie-ospg);" aria-label="OSPG">●</span> ' + fmtMoneda.format(d);
        } },

      { data: 'difPct', className: 'text-center fw-bold',
        render: function (d, t, row) {
          if (t !== 'display') return paraOrden(d);
          if (d === null || d === undefined) return guion();
          const esSMC = row.compradorEficiente === 'SMC';
          const color = esSMC ? 'var(--status-good)' : 'var(--status-critical)';
          const flecha = esSMC ? '▲' : '▼';
          return '<span style="color:' + color + ';">' + flecha + ' ' + fmtNumero.format(d) + '%</span>';
        } },

      { data: 'ahorro', className: 'text-end fw-bold',
        render: function (d, t) { return t === 'display' ? (d === null || d === undefined ? guion() : fmtMoneda.format(d)) : paraOrden(d); } }
    ],
    createdRow: function (tr) { $(tr).css('cursor', 'pointer'); }
  });

  $('#fBuscar').on('keyup', function () { TABLA.search(this.value).draw(); });
  $('#fTipo, #fProveedor, #fComparables').on('change', function () { TABLA.draw(); });
  $('#tablaMaestra tbody').on('click', 'tr', function () {
    const d = TABLA.row(this).data();
    if (d) abrirDetalle(d);
  });
}

/* Filtros que DataTables no cubre solo */
$.fn.dataTable.ext.search.push(function (settings, dataRow, index, row) {
  if (settings.nTable.id !== 'tablaMaestra' || !row) return true;
  const tipo = $('#fTipo').val();
  if (tipo && row.tipo !== tipo) return false;
  const prov = $('#fProveedor').val();
  if (prov && lado(row, 'smc', 'proveedor') !== prov && lado(row, 'ospg', 'proveedor') !== prov) return false;
  if ($('#fComparables').is(':checked') && !(row.smc && row.ospg)) return false;
  return true;
});

/* ---------------------------------------------------------------- drill-down */

async function abrirDetalle(fila) {
  $('#detalleTitulo').text(fila.droga + ' · ' + (fila.potencia || 's/d'));
  $('#detalleCuerpo').html('<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div></div>');
  const off = new bootstrap.Offcanvas(document.getElementById('panelDetalle'));
  off.show();

  try {
    const det = await llamar('apiGetDetalle', fila.clave);
    let html = '<div class="row g-2 mb-3">' +
      tarjetaLado('SMC', fila.smc, 'var(--serie-smc)') +
      tarjetaLado('OSPG', fila.ospg, 'var(--serie-ospg)') + '</div>';

    if (det.resumenPorSistema.length) {
      const max = Math.max.apply(null, det.resumenPorSistema.map(s => s.precioMax || 0)) || 1;
      html += '<h6 class="text-secondary mt-3">Precio unitario por sistema</h6>';
      det.resumenPorSistema.forEach(function (s) {
        const p = s.unidades ? s.total / s.unidades : 0;
        const ancho = Math.max(2, Math.round(p / max * 100));
        html += '<div class="d-flex align-items-center mb-2">' +
          '<div style="width:90px;font-size:.8rem;">' + escapar(s.sistema) + '</div>' +
          '<div style="flex:1;"><div style="height:18px;border-radius:0 4px 4px 0;background:var(--serie-ospg);width:' + ancho + '%;"></div></div>' +
          '<div style="width:130px;text-align:right;font-size:.85rem;">' + fmtMoneda.format(p) + '</div></div>';
      });
    }

    html += '<h6 class="text-secondary mt-4">Datos crudos</h6>';
    det.lineas.forEach(function (l) {
      html += '<div class="border rounded p-2 mb-2" style="font-size:.85rem;">' +
        '<div class="d-flex justify-content-between">' +
          '<strong>' + escapar(l.sistema) + ' · ' + escapar(l.fuente) + ' fila ' + escapar(l.fila) + '</strong>' +
          '<span class="badge bg-light text-secondary">' + escapar(l.origenPA) + '</span>' +
        '</div>' +
        '<div class="text-muted font-monospace mt-1">' + escapar(l.descripcionRaw) + '</div>' +
        '<div class="mt-1">Cant. ' + escapar(l.cantidadEnvases) + ' × ' + escapar(l.unidadesEnvase || 1) +
          ' un. · ' + (l.precioEnvase === null ? '—' : fmtMoneda.format(l.precioEnvase)) + '/envase</div>' +
        '<div class="text-muted">' + escapar([l.marca, l.proveedor].filter(Boolean).join(' · ')) + '</div>' +
      '</div>';
    });

    $('#detalleCuerpo').html(html);
  } catch (e) {
    $('#detalleCuerpo').html('<div class="alert alert-danger">' + escapar(e.message) + '</div>');
  }
}

function tarjetaLado(nombre, obj, color) {
  if (!obj) return '<div class="col-6"><div class="border rounded p-2 text-muted"><small>' + nombre + '</small><br>sin compras</div></div>';
  return '<div class="col-6"><div class="border rounded p-2">' +
    '<small><span style="color:' + color + ';">●</span> ' + nombre + '</small><br>' +
    '<strong>' + fmtNumero.format(obj.unidades || 0) + ' un.</strong><br>' +
    (obj.precioUnitario === null ? '—' : fmtMoneda.format(obj.precioUnitario)) + '/un.' +
    '</div></div>';
}

