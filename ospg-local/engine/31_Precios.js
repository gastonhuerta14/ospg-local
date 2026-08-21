function calcularLinea_(rec) {
  const cant = aNumero_(rec.cantidadEnvases);
  const uxe  = rec.unidadesEnvase && rec.unidadesEnvase > 0 ? rec.unidadesEnvase : null;

  rec.unidadesMinimas = cant === null ? null : cant * (uxe || 1);
  if (cant !== null && !uxe) rec.flags.push('ENVASE_ASUMIDO_1');

  let precio = aNumero_(rec.precioEnvase);
  if (precio !== null && !CFG.PRECIO_INCLUYE_IVA) precio = precio * (1 + CFG.IVA);
  rec.precioEnvaseFinal = precio;

  rec.precioUnitario = (precio === null) ? null : precio / (uxe || 1);
  rec.totalLinea     = (precio === null || cant === null) ? null : precio * cant;
}

function ponderar_(lineas) {
  let unidades = 0, total = 0;
  lineas.forEach(l => {
    if (l.unidadesMinimas && l.precioUnitario !== null) {
      unidades += l.unidadesMinimas;
      total    += l.unidadesMinimas * l.precioUnitario;
    }
  });
  return {
    unidades: unidades || null,
    total: total || null,
    precioUnitario: unidades ? total / unidades : null,
    lineas: lineas.length
  };
}

function calcularAhorro_(pSMC, pOSPG, cantidadTotal) {
  if (pSMC === null || pOSPG === null) {
    return { difUnitaria: null, difPct: null, ahorro: null, compradorEficiente: null };
  }
  const menor = Math.min(pSMC, pOSPG), mayor = Math.max(pSMC, pOSPG);
  return {
    difUnitaria: pOSPG - pSMC,
    difPct: menor ? (mayor - menor) / menor * 100 : null,
    ahorro: cantidadTotal ? (mayor - menor) * cantidadTotal : null,
    compradorEficiente: pSMC <= pOSPG ? 'SMC' : 'OSPG'
  };
}