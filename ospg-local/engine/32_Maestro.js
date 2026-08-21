/**
 * 32_Maestro.gs — Ensamblado del Gold. VERSIÓN CORREGIDA (code review final).
 *
 * Correcciones sobre la versión revisada:
 *  1. `presentacion` producía el string literal "null" cuando no había forma
 *     (concatenación de un null). Ahora devuelve null y la UI muestra "—".
 *  2. Se propaga `tipo` (MEDICAMENTO / INSUMO) a la fila del maestro: sin eso
 *     el frontend no puede separar medicamentos de insumos.
 *  3. La cola de revisión se devuelve ACHICADA y con los identificadores que
 *     `apiGuardarDecision` necesita. Antes viajaban los SilverRecord completos.
 *  4. Se propagan `truncado`, `noProcesados` y `stats` del cruce, para que la
 *     UI pueda avisar si el motor recortó por presupuesto de tiempo.
 *  5. Las filas con ENVASE_AMBIGUO no aportan ahorro: su precio unitario no es
 *     confiable y encabezarían la tabla con una diferencia inventada.
 */

function armarPresentacion_(r) {
  const forma = r.forma || null;
  const uxe = r.unidadesEnvase || null;
  if (!forma && !uxe) return null;
  if (!forma) return 'x ' + uxe;
  return uxe ? forma + ' x ' + uxe : forma;
}

function tieneEnvaseAmbiguo_(lineas) {
  return lineas.some(l => (l.flags || []).indexOf('ENVASE_AMBIGUO') >= 0);
}

function ladoResumen_(consol, ref, lineas) {
  return {
    unidades: consol.unidades,
    precioUnitario: consol.precioUnitario,
    total: consol.total,
    marca: ref.marca || null,
    proveedor: ref.proveedor || null,
    lineas: consol.lineas,
    sistemas: Array.from(new Set(lineas.map(x => x.sistema)))
  };
}

function construirMaestroCore_(silverRecords, crosswalk) {
  const gruposSMC = {}, gruposOSPG = {};

  silverRecords.forEach(r => {
    if (!r.claveL2 || r.claveL2.charAt(0) === '|') return;   // sin PA, no cruza
    const target = r.lado === 'SMC' ? gruposSMC : gruposOSPG;
    if (!target[r.claveL2]) target[r.claveL2] = [];
    target[r.claveL2].push(r);
  });

  const cruce = cruzar_(gruposSMC, gruposOSPG, crosswalk);
  const maestro = [];

  cruce.pares.forEach(par => {
    const lineasSMC = gruposSMC[par.smc.claveL2];
    const lineasOSPG = gruposOSPG[par.ospg.claveL2];
    const consolSMC = ponderar_(lineasSMC);
    const consolOSPG = ponderar_(lineasOSPG);

    const totalConsolidado = (consolSMC.unidades || 0) + (consolOSPG.unidades || 0);
    const ambiguo = tieneEnvaseAmbiguo_(lineasSMC) || tieneEnvaseAmbiguo_(lineasOSPG);

    // Si el tamaño de envase es ambiguo, el precio unitario puede estar dividido
    // por 100 de un lado y no del otro: publicar ese "ahorro" sería inventarlo.
    const fin = ambiguo
      ? { difUnitaria: null, difPct: null, ahorro: null, compradorEficiente: null }
      : calcularAhorro_(consolSMC.precioUnitario, consolOSPG.precioUnitario, totalConsolidado);

    const flags = [];
    if (ambiguo) flags.push('ENVASE_AMBIGUO');
    const tamanos = Array.from(new Set(
      lineasSMC.concat(lineasOSPG).map(x => x.unidadesEnvase).filter(Boolean)));
    if (tamanos.length > 1) flags.push('ENVASES_DISTINTOS:' + tamanos.join('/'));

    maestro.push({
      clave: par.smc.claveL2,
      tipo: par.smc.tipo || par.ospg.tipo || 'INDETERMINADO',
      droga: par.smc.principioActivo,
      potencia: par.smc.discriminante || par.smc.potenciaTxt || null,
      presentacion: armarPresentacion_(par.smc) || armarPresentacion_(par.ospg),
      smc: ladoResumen_(consolSMC, par.smc, lineasSMC),
      ospg: ladoResumen_(consolOSPG, par.ospg, lineasOSPG),
      cantidadTotal: totalConsolidado || null,
      difUnitaria: fin.difUnitaria,
      difPct: fin.difPct,
      ahorro: fin.ahorro,
      compradorEficiente: fin.compradorEficiente,
      nivelMatch: par.nivel,
      score: par.score,
      flags: flags
    });
  });

  cruce.soloSMC.forEach(r => {
    const lineas = gruposSMC[r.claveL2];
    const consol = ponderar_(lineas);
    maestro.push({
      clave: r.claveL2, tipo: r.tipo || 'INDETERMINADO',
      droga: r.principioActivo,
      potencia: r.discriminante || r.potenciaTxt || null,
      presentacion: armarPresentacion_(r),
      smc: ladoResumen_(consol, r, lineas),
      ospg: null,
      cantidadTotal: consol.unidades,
      difUnitaria: null, difPct: null, ahorro: null, compradorEficiente: null,
      nivelMatch: 'SIN_MATCH', score: null,
      flags: ['SOLO_SMC']
    });
  });

  cruce.soloOSPG.forEach(r => {
    const lineas = gruposOSPG[r.claveL2];
    const consol = ponderar_(lineas);
    maestro.push({
      clave: r.claveL2, tipo: r.tipo || 'INDETERMINADO',
      droga: r.principioActivo,
      potencia: r.discriminante || r.potenciaTxt || null,
      presentacion: armarPresentacion_(r),
      smc: null,
      ospg: ladoResumen_(consol, r, lineas),
      cantidadTotal: consol.unidades,
      difUnitaria: null, difPct: null, ahorro: null, compradorEficiente: null,
      nivelMatch: 'SIN_MATCH', score: null,
      flags: ['SOLO_OSPG']
    });
  });

  // Los rubros de prestación (AGREGADO) no cruzan contra nada, pero su plata
  // TIENE que seguir a la vista. Si se caen del maestro, la reconciliación de
  // importes pasa a mostrar un delta y ese dinero desaparece del informe en
  // silencio — que es exactamente lo que un cruce de compras no puede hacer.
  // Van marcados, para que la UI los muestre aparte y nadie los cuente como
  // artículos sin match.
  [['smc', cruce.excluidos.smc, gruposSMC], ['ospg', cruce.excluidos.ospg, gruposOSPG]]
    .forEach(function (par) {
      const lado = par[0], lista = par[1], grupos = par[2];
      lista.forEach(r => {
        const lineas = grupos[r.claveL2] || [r];
        const consol = ponderar_(lineas);
        maestro.push({
          clave: r.claveL2, tipo: 'AGREGADO',
          droga: r.principioActivo,
          potencia: null,
          presentacion: armarPresentacion_(r),
          smc: lado === 'smc' ? ladoResumen_(consol, r, lineas) : null,
          ospg: lado === 'ospg' ? ladoResumen_(consol, r, lineas) : null,
          cantidadTotal: consol.unidades,
          difUnitaria: null, difPct: null, ahorro: null, compradorEficiente: null,
          nivelMatch: 'NO_ES_ARTICULO', score: null,
          flags: ['NO_ES_ARTICULO']
        });
      });
    });

  maestro.sort((a, b) => {
    if (a.ahorro === null && b.ahorro === null) return 0;
    if (a.ahorro === null) return 1;
    if (b.ahorro === null) return -1;
    return b.ahorro - a.ahorro;
  });

  // La cola de revisión viaja achicada: sólo lo que la UI muestra y lo que
  // `apiGuardarDecision` necesita para identificar las dos puntas.
  const revision = cruce.revision.map(x => ({
    score: x.score, base: x.base, motivo: x.motivo, umbralAplicado: x.umbralAplicado,
    smc: {
      sistema: x.smc.sistema, id: x.smc.codigoOrigen, fuente: x.smc.fuente, fila: x.smc.fila,
      descripcionRaw: x.smc.descripcionRaw, principioActivo: x.smc.principioActivo,
      discriminante: x.smc.discriminante, tipo: x.smc.tipo, clave: x.smc.claveL2
    },
    ospg: {
      sistema: x.candidato.sistema, id: x.candidato.codigoOrigen, fuente: x.candidato.fuente,
      fila: x.candidato.fila, descripcionRaw: x.candidato.descripcionRaw,
      principioActivo: x.candidato.principioActivo, discriminante: x.candidato.discriminante,
      tipo: x.candidato.tipo, clave: x.candidato.claveL2
    }
  }));

  return {
    maestro: maestro,
    revision: revision,
    stats: cruce.stats,
    truncado: cruce.truncado,
    noProcesados: cruce.noProcesados,
    duracionMs: cruce.duracionMs
  };
}
