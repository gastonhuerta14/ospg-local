/* ==========================================================================
 * 21_Parser.gs — Extracción de la tupla semántica (VERSIÓN BLINDADA AUDITORÍA)
 * ========================================================================== */

const UNIDADES = {
  'MG': ['MG', 1], 'MGR': ['MG', 1], 'MGS': ['MG', 1], 'MILIGRAMOS': ['MG', 1],
  'G': ['MG', 1000], 'GR': ['MG', 1000], 'GRS': ['MG', 1000], 'GRAMOS': ['MG', 1000],
  'MCG': ['MG', 0.001], 'UG': ['MG', 0.001], 'MICROGRAMOS': ['MG', 0.001], 'MICROGRAMO': ['MG', 0.001], 'GAMMA': ['MG', 0.001], 'GAMMAS': ['MG', 0.001],
  'UI': ['UI', 1], 'U': ['UI', 1], 'UNIDADES': ['UI', 1], 'UNIDAD': ['UI', 1],
  'ML': ['ML', 1], 'CC': ['ML', 1], 'L': ['ML', 1000], 'LITRO': ['ML', 1000],
  'MEQ': ['MEQ', 1]
};
const U_ALT = Object.keys(UNIDADES).sort((a, b) => b.length - a.length).join('|');
const U_MASA = { 'MG': true, 'UI': true, 'MEQ': true };

const FORMAS = {
  'COMPRIMIDO': ['COMP','COMPS','COMPR','CPR','COMPRIMIDO','COMPRIMIDOS','TAB','TABLETA','TABLETAS','GRAGEA','GRAGEAS','COMP REC','COMP RECUB','COMP LIB PROL','COMPRIMIDO RECUBIERTO','COMPRIMIDOS RECUBIERTOS','COMP MASTICABLE'],
  'CAPSULA':    ['CAP','CAPS','CAPSULA','CAPSULAS','PERLA','PERLAS','CAPSULA BLANDA'],
  'AMPOLLA':    ['AMP','AMPS','AMPOLLA','AMPOLLAS','AMPOLLA BEBIBLE'],
  'VIAL':       ['VIAL','VIALES','FCO AMP','FCO-AMP','FRASCO AMPOLLA','FRASCO-AMPOLLA','FA'],
  'JERINGA PRELLENADA': ['JGA PRELL','JER PRELL','JERINGA PRELLENADA','JERINGA PRE LLENADA','JGA','JP'],
  'LAPICERA':   ['LAPICERA','LAPICERAS','PEN','BIROME','FLEXPEN','KWIKPEN','SOLOSTAR','CARTUCHO','CARTUCHOS','PENFILL'],
  'POLVO LIOFILIZADO': ['LIOF','LIOFILIZADO','POLVO LIOF','PVO LIOF','POLVO','POLVO PARA SOLUCION'],
  'SOLUCION INYECTABLE': ['SOL INY','SOLUCION INYECTABLE','INYECTABLE','INY','SOL. INY'],
  'SOLUCION':   ['SOL','SOLUCION','SOL ORAL','SOLUCION ORAL'],
  'SUSPENSION': ['SUSP','SUSPENSION','SUSP ORAL'],
  'JARABE':     ['JBE','JARABE'],
  'GOTAS':      ['GTS','GOTAS','COLIRIO','GOTAS OFTALMICAS'],
  'CREMA':      ['CREMA','CR'],  'POMADA': ['POM','POMADA','UNGUENTO'],  'GEL': ['GEL'],
  'SOBRE':      ['SOBRE','SOBRES','SACHET','SACHETS'],
  'SUPOSITORIO':['SUP','SUPOSITORIO','SUPOSITORIOS','OVULO','OVULOS'],
  'AEROSOL':    ['AEROSOL','SPRAY','INH','INHALADOR','TURBUHALER','PUFF'],
  'PARCHE':     ['PARCHE','PARCHES'],
  'FRASCO':     ['FCO','FRASCO','FRASCOS','BOTELLA'],
  'BOLSA':      ['BOLSA','BOLSAS','FLEXIBLE']
};
const FORMA_IDX = (function () {
  const out = [];
  for (const canon in FORMAS) FORMAS[canon].forEach(v => out.push([v, canon]));
  return out.sort((a, b) => b[0].length - a[0].length);
})();

const INSUMOS = ['AGUJA','AGUJAS','JERINGA','JERINGAS','GUANTE','GUANTES','SONDA','SONDAS','CATETER','CATETERES','CLIP','CLIPS','GASA','GASAS','VENDA','VENDAS','APOSITO','APOSITOS','TUBULADURA','TUBULADURAS','LLAVE','TROCAR','TROCARES','SUTURA','SUTURAS','BISTURI','ELECTRODO','ELECTRODOS','CANULA','CANULAS','MASCARA','MASCARILLA','BARBIJO','CAMISOLIN','BOTON GASTRICO','BOLSA COLECTORA','EQUIPO DE SUERO','EQUIPO PARA SUERO','PROLONGADOR','FILTRO','PAÑAL','PANAL','PAÑALES','TERMOMETRO','TELA ADHESIVA','CINTA','ALGODON','HISOPO','HISOPOS','LANCETA','LANCETAS','TIRA REACTIVA','TIRAS REACTIVAS','BRANULA','ABBOCATH','MARIPOSA','SET DE INFUSION','GORRO','BOTA','CUBRECALZADO','CAMPO QUIRURGICO','DRENAJE','COLECTOR','ESPECULO','DEPRESOR','GUIA','MALLA','PROTESIS','STENT','VALVULA'];
const INSUMO_RX = new RegExp('\\b(' + INSUMOS.map(s => s.replace(/ /g, '\\s+')).join('|') + ')\\b');
const RUIDO = new Set(['MEDICAMENTO','MEDICAMENTOS','DROGA','GENERICO','GENERICOS','VARIOS','ARTICULO','PRODUCTO','ITEM','IVA','INCLUIDO','NACIONAL','IMPORTADO','SIN','ESPECIFICAR','DESCARTABLE','ESTERIL','COMUN','SURTIDO','UNIDAD','UNIDADES','DE','DEL','LA','EL','LO','LOS','LAS','UN','UNA','PARA','CON','POR','EN','AL','Y','O']);
// Rubros del nomenclador de SMC: son líneas de PRESTACIÓN, no artículos
// comprables. "MATERIAL CIRUGIA GENERAL" no tiene contraparte posible en un
// listado de compras y sólo ensucia la cola de huérfanos. Se agregan en plural
// o como sustantivo pelado para no pisar artículos reales: OSPG tiene
// "MALLA PROLENE" (singular, con marca), que NO cae acá.
const AGREGADO_RX = /^(MEDICAMENTOS?\s+CRONICOS?|VARIOS|OTROS|INSUMOS?\s+VARIOS|MEDICAMENTOS?\s+VARIOS|SIN\s+ESPECIFICAR|A\s+DEFINIR|MATERIALES?\b|PROTESIS\b|ORTESIS\b|AUDIFONOS?\b|MALLAS\b|BOLSAS?\s+COLOSTOMIA|MEDICAMENTOS?\s+ONCOLOGICOS?|ONCOLOGICOS?\b)\b/;

function limpiarUnidades_(s) {
  return normalizar_(s).replace(/\b([A-Z])\.([A-Z])\.(?![A-Z])/g, '$1$2').replace(/\b(MG|MCG|UI|ML|CC|GR|MEQ|UG)\.(?![A-Z0-9])/g, '$1').replace(/\bMICROGRAMOS?\b/g, 'MCG').replace(/\bGAMMAS?\b/g, 'MCG').replace(new RegExp('(\\d)\\s*(' + U_ALT + ')(?![A-Z])', 'g'), '$1 $2').replace(new RegExp('(\\d)\\s*(' + U_ALT + ')(?=[A-Z])', 'g'), function (todo, d, u, pos, str) { const resto = str.substring(pos + todo.length); return esInicioDeForma_(resto) ? d + ' ' + u + ' ' : todo; }).replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
}
function esInicioDeForma_(resto) {
  for (let i = 0; i < FORMA_IDX.length; i++) { const v = FORMA_IDX[i][0]; if (resto.indexOf(v) === 0) { const sig = resto.charAt(v.length); if (sig === '' || !/[A-Z]/.test(sig)) return true; } } return false;
}

// NUEVO: Filtro Lista Blanca para basura de Alfabeta (Auditoría A-4)
function hintValido_(h) {
  if (!h) return false;
  const s = normalizar_(h);
  if (s.length < 4 || s.indexOf('(') >= 0 || s.indexOf(')') >= 0) return false;
  if (/N\/A|S\/D|\bNO APLICA\b|\bDISPOSITIVO\b|\bRUBRO\b/.test(s)) return false;
  const tokens = s.split(/[^\wÑ]+/);
  return tokens.some(t => t.length >= 4 && /[A-Z]/.test(t));
}

function clasificarArticulo_(desc, hintCrudo) {
  const s = normalizar_(desc);
  if (AGREGADO_RX.test(s)) return 'AGREGADO';
  const hint = normalizar_(hintCrudo || '');
  if (hint.includes('DISPOSITIVO') || hint.includes('INSUMO')) return 'INSUMO';
  if (hintValido_(hintCrudo)) return 'MEDICAMENTO';
  if (INSUMO_RX.test(s)) return 'INSUMO';
  if (buscarForma_(s)) return 'MEDICAMENTO';
  const m = s.match(new RegExp('\\d\\s*(MG|MGR|MCG|UI|MEQ|UG|GAMMA)\\b'));
  return m ? 'MEDICAMENTO' : 'INDETERMINADO';
}

const NUM_RX = '\\d{1,3}(?:\\.\\d{3})+|\\d+(?:[.,]\\d+)?';
function candidatosPotencia_(s) {
  const rx = new RegExp('(' + NUM_RX + ')\\s*(' + U_ALT + ')\\b', 'g');
  const out = []; let m;
  while ((m = rx.exec(s)) !== null) {
    const fam = UNIDADES[m[2]], v = aNumero_(m[1]);
    if (v === null || fam === undefined) continue;
    out.push({ valor: v, factor: fam[1], familia: fam[0], unidadRaw: m[2], inicio: m.index, fin: m.index + m[0].length, texto: m[0], base: v * fam[1] });
  }
  return out;
}

function parsearPotencia_(desc) {
  const s = limpiarUnidades_(desc); const c = candidatosPotencia_(s); const vacio = { valor:null, unidad:null, porValor:null, porUnidad:null, texto:null, txt:'' };
  if (!c.length) return vacio;
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1]; const pegados = s.substring(a.fin, b.inicio).replace(/\s/g, '') === '/';
    if (pegados && U_MASA[a.familia] && b.familia === 'ML') return { valor:a.base, unidad:a.familia, porValor:b.base, porUnidad:'ML', texto: s.substring(a.inicio, b.fin), txt: fmt_(a.base) + a.familia + '/' + fmt_(b.base) + 'ML' };
  }
  for (let i = 0; i < c.length; i++) {
    const a = c[i], mm = s.substring(a.fin).match(/^\/(ML|CC)\b/);
    if (mm && U_MASA[a.familia]) return { valor:a.base, unidad:a.familia, porValor:1, porUnidad:'ML', texto: a.texto + mm[0], txt: fmt_(a.base) + a.familia + '/1ML' };
  }
  for (let i = 0; i < c.length - 1; i++) {
    const a = c[i], b = c[i + 1], entre = s.substring(a.fin, b.inicio).replace(/\s/g, '');
    if ((entre === '+' || entre === '/') && a.familia === b.familia && U_MASA[a.familia]) {
      const p = [a.base, b.base].sort((x, y) => y - x);
      return { valor:p[0], unidad:a.familia, porValor:null, porUnidad:null, combo:[p[0], p[1]], texto: s.substring(a.inicio, b.fin), txt: fmt_(p[0]) + a.familia + '+' + fmt_(p[1]) + a.familia };
    }
  }
  const combo = s.match(new RegExp('(' + NUM_RX + ')\\/(' + NUM_RX + ')\\s*(' + U_ALT + ')\\b'));
  if (combo) {
    const fam = UNIDADES[combo[3]];
    if (fam && U_MASA[fam[0]]) {
      const p = [aNumero_(combo[1]) * fam[1], aNumero_(combo[2]) * fam[1]].sort((x, y) => y - x);
      return { valor:p[0], unidad:fam[0], porValor:null, porUnidad:null, combo:p, texto: combo[0], txt: fmt_(p[0]) + fam[0] + '+' + fmt_(p[1]) + fam[0] };
    }
  }
  const dosis = c.filter(x => U_MASA[x.familia]); const elegido = dosis.length ? dosis[0] : c[0];
  if (esGaugeNoGramos_(s, elegido)) return vacio;
  return { valor:elegido.base, unidad:elegido.familia, porValor:null, porUnidad:null, texto:elegido.texto, txt: fmt_(elegido.base) + elegido.familia };
}

function esGaugeNoGramos_(s, cand) {
  if (cand.unidadRaw !== 'G') return false; if (cand.valor % 1 !== 0 || cand.valor < 10 || cand.valor > 34) return false; if (buscarForma_(s)) return false; return true;
}
function fmt_(n) { return String(parseFloat(Number(n).toFixed(6))); }

const MEDIDAS = [
  { rx: /(?:\bCAL(?:IBRE)?\s*)?\b(\d{2}(?:[.,]\d)?)\s*(?:G|GA|GAUGE)\b/, pre: 'G' },
  { rx: /\b(\d{1,2}(?:[.,]\d)?)\s*(?:FR|FRENCH|CH|CHARR(?:IERE)?)\b/, pre: 'FR' },
  { rx: /\b(?:N|NRO|NUM(?:ERO)?|TALLE|TALLA|MEDIDA)\s*[°º]?\s*(\d{1,3}(?:[.,]\d)?)\b/, pre: 'N' },
  { rx: /\bT\s*[°º]?\s*(\d{1,2}(?:[.,]\d)?)\b/, pre: 'N' },
  { rx: /\b(\d{1,4}(?:[.,]\d+)?)\s*(?:MM|MILIMETROS?)\b/, pre: 'MM' },
  { rx: /\b(\d{1,4}(?:[.,]\d+)?)\s*(?:CM|CENTIMETROS?)\b/, pre: 'CM' },
  { rx: /\b(\d{1,5}(?:[.,]\d+)?)\s*(?:ML|CC)\b/, pre: 'ML' }
];
const DIM_RX = /\b(\d{1,3})\s*[X]\s*(\d{1,3})\b(?!\s*(?:MG|ML|UI|MCG|G)\b)/;
const TALLES_TXT = { 'CHICO':'S','CH':'S','PEQUENO':'S','PEQ':'S','SMALL':'S','MEDIANO':'M','MEDIA':'M','MED':'M','MEDIUM':'M','GRANDE':'L','GDE':'L','LARGE':'L','EXTRA GRANDE':'XL','XL':'XL' };
const TALLE_RX = /\b(EXTRA GRANDE|CHICO|PEQUENO|MEDIANO|GRANDE|SMALL|MEDIUM|LARGE|MEDIA|MED|GDE|PEQ|CH|XL)\b/;

function parsearMedida_(desc) {
  const s = limpiarUnidades_(desc); const partes = [], textos = [];
  MEDIDAS.forEach(p => { const m = s.match(p.rx); if (m) { const v = aNumero_(m[1]); if (v !== null) { partes.push(p.pre + fmt_(v)); textos.push(m[0]); } } });
  const md = s.match(DIM_RX); if (md) { partes.push('DIM' + md[1] + 'x' + md[2]); textos.push(md[0]); }
  const mt = s.match(TALLE_RX); if (mt) { partes.push('T' + TALLES_TXT[mt[1]]); textos.push(mt[0]); }
  if (!partes.length) return { txt:'', texto:null, partes:[] }; return { txt: partes.join('+'), texto: textos.join(' '), partes: partes };
}

function buscarForma_(txt) {
  const t = ' ' + normalizar_(txt) + ' ';
  for (let i = 0; i < FORMA_IDX.length; i++) { const v = FORMA_IDX[i][0]; if (t.indexOf(' ' + v + ' ') >= 0 || t.indexOf(' ' + v + '.') >= 0) return FORMA_IDX[i][1]; }
  return null;
}

function parsearPresentacion_(desc, discTexto, tipo) {
  const s = limpiarUnidades_(desc); let forma = buscarForma_(s); const sinDisc = discTexto ? s.split(discTexto).join(' ') : s;
  let unidades = null; let ambiguo = false;
  const m = sinDisc.match(/(?:\bX\s*|\bPOR\s+)(\d{1,4})(?!\s*(?:MG|G|ML|UI|MCG|CC|MEQ|%|FR|CM|MM))/);
  if (m) {
    unidades = aNumero_(m[1]);
    const post = buscarForma_(sinDisc.substr(m.index + m[0].length, 30));
    if (post) forma = post;
    else if (tipo === 'INSUMO') ambiguo = true; // NUEVO: Todo X n en insumos es ambiguo para proteger el precio unitario
  } else {
    const m2 = sinDisc.match(/\b(\d{1,4})\s+([A-Z]{2,})/);
    if (m2 && buscarForma_(m2[2])) unidades = aNumero_(m2[1]);
  }
  if (unidades !== null && (unidades <= 0 || unidades > 5000)) unidades = null;
  return { forma: forma, unidades: unidades, texto: m ? m[0] : null, ambiguo: ambiguo };
}

function resolverPA_(descLimpia, disc, presentacion, hintColumna, dic) {
  const cabeza = cabezaDescriptiva_(descLimpia, disc, presentacion);
  if (hintValido_(hintColumna)) {
    const mono = normalizar_(hintColumna);
    if (mono && !RUIDO.has(mono)) {
      if (cabeza && cabeza !== mono) dic.aprender(cabeza, mono, 'AUTO');
      return { pa: mono, origen: 'COLUMNA' };
    }
  }
  const conocido = dic.buscar(cabeza);
  if (conocido) return { pa: conocido, origen: 'DICCIONARIO' };
  return { pa: cabeza, origen: 'REGEX' };
}

function cabezaDescriptiva_(s, disc, presentacion) {
  let t = limpiarUnidades_(s);
  if (disc && disc.texto) { const i = t.indexOf(disc.texto); if (i > 0) t = t.substring(0, i); else t = t.split(disc.texto).join(' '); }
  FORMA_IDX.forEach(par => { t = t.split(' ' + par[0] + ' ').join(' '); });
  if (presentacion.texto) t = t.split(presentacion.texto).join(' ');
  t = t.replace(new RegExp('\\b(' + U_ALT + ')\\b', 'g'), ' ').replace(/[\d%]/g, ' ');
  return t.split(/[^\wÑ+]+/).filter(w => w.length > 1 && !RUIDO.has(w)).join(' ').trim();
}

// NUEVO: Generador de Hash Estable para reemplazar SAES::null (Auditoría A-1b)
function generarIdEstable_(codigoOrigen, descripcionRaw) {
  if (codigoOrigen) return String(codigoOrigen).trim();
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, descripcionRaw);
  return Utilities.base64Encode(raw).substr(0, 12);
}

function parsearDescripcion_(descRaw, hintColumna, dic, codExterno) {
  const par = separarCodDesc_(descRaw);
  const cod = codExterno || par[0];
  const desc = par[1];
  const tipo = clasificarArticulo_(desc, hintColumna);

  let potencia = { txt:'', texto:null, valor:null, unidad:null, porValor:null, porUnidad:null };
  let medida = { txt:'', texto:null, partes:[] };

  if (tipo === 'INSUMO') medida = parsearMedida_(desc);
  else if (tipo !== 'AGREGADO') {
    potencia = parsearPotencia_(desc);
    if (!potencia.txt) medida = parsearMedida_(desc);
  }

  const discTexto = potencia.texto || medida.texto;
  const pres = parsearPresentacion_(desc, discTexto, tipo);
  const pa = resolverPA_(desc, { texto: discTexto }, pres, hintColumna, dic);
  const r = {
    codigoOrigen: generarIdEstable_(cod, descRaw), // Aplica Identidad Estable
    descripcionLimpia: desc,
    textoComparable: limpiarUnidades_(desc),
    tipo: tipo,
    principioActivo: pa.pa,
    paOriginal: pa.pa, // NUEVO: Respaldo para re-resolución reversible
    origenPA: pa.origen,
    potenciaTxt: potencia.txt,
    potenciaValor: potencia.valor,
    potenciaUnidad: potencia.unidad,
    porValor: potencia.porValor,
    porUnidad: potencia.porUnidad,
    medidaTxt: medida.txt,
    discriminante: potencia.txt || medida.txt || '',
    forma: pres.forma,
    unidadesEnvase: pres.unidades,
    flags: []
  };
  if (!r.principioActivo) r.flags.push('PA_VACIO');
  if (!r.discriminante) r.flags.push('SIN_DISCRIMINANTE');
  if (!r.forma && r.tipo === 'MEDICAMENTO') r.flags.push('SIN_FORMA');
  if (!r.unidadesEnvase && !pres.ambiguo) r.flags.push('ENVASE_ASUMIDO_1');
  if (pres.ambiguo) r.flags.push('ENVASE_AMBIGUO');
  if (r.tipo === 'AGREGADO') r.flags.push('NO_ES_ARTICULO');
  construirClaves_(r); return r;
}

function construirClaves_(r) {
  const d = r.discriminante || '';
  r.claveL1 = [r.principioActivo, d, r.forma || '?', r.unidadesEnvase || '?'].join('|');
  r.claveL2 = [r.principioActivo, d, r.forma || '?'].join('|');
  r.claveL3 = [r.principioActivo, d].join('|');
  return r;
}

function separarCodDesc_(raw) {
  const s = normalizar_(raw); if (!s) return [null, ''];
  // El nomenclador de SMC usa códigos de VARIOS grupos: "AC 51221 0062 - ...".
  // Con un solo grupo numérico el match fallaba y el código quedaba pegado a la
  // descripción: sus dígitos contaminaban el parseo de potencia (de ahí
  // discriminantes como "100ML" donde debía decir "100MG") y AGREGADO_RX, que
  // está anclado en ^, nunca podía reconocer un rubro de prestación.
  let m = s.match(/^([A-Z]{1,5}[\s.\-]?\d{2,10}(?:[\s.\-]\d{1,6})*[A-Z]?|\d{3,12})\s*(?:[-–—:|\/]|\s{2,})\s*(\S[\s\S]*)$/);
  if (!m) m = s.match(/^([A-Z]{2,5}\d{3,8}|\d{4,12})\s+([A-Z][\s\S]*)$/);
  if (m && m[2]) return [m[1].replace(/[\s.\-]/g, ''), m[2].replace(/^[\s\-:|\/]+/, '')];
  return [null, s];
}