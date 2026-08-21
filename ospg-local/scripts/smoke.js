const path=require('node:path');
const { crearApi } = require('../src/api');
const api = crearApi({ raiz: require('node:path').join(__dirname,'..'), usuario: 'gaston@ospg' });

console.log('── estado inicial ──');
const e0 = api.estado();
console.log('  periodo:', e0.periodo, '| usuario:', e0.usuario.email, '('+e0.usuario.rol+')');
console.log('  gold:', e0.gold, '| enRevision:', e0.enRevision);

console.log('\n── ingesta de los 6 ──');
for (let i = 0; i < 6; i++) {
  const r = api.ingestarArchivo(i);
  console.log('  [' + i + ']', String(r.id).padEnd(22), r.estado,
    '| filas', String(r.registrosValidos ?? '-').padStart(3),
    '| dic', (r.diccionario ? r.diccionario.previos + '→' + r.diccionario.total : '-'),
    '| re-res', r.reResueltos ?? '-',
    (r.columnasNoEncontradas && r.columnasNoEncontradas.length ? '| sin col: ' + r.columnasNoEncontradas.join(',') : ''));
}

console.log('\n── cruce ──');
const m = api.construirMaestro();
console.log('  artículos:', m.articulos, '| revisión:', m.enRevision, '| truncado:', m.truncado, '|', m.duracionMs + 'ms');
m.qa.forEach(c => console.log('   ', (c.ok ? 'OK  ' : '!!  ') + c.check, 'delta=' + c.delta));

console.log('\n── maestro ──');
api.getMaestro().forEach(f => console.log('  ',
  String(f.droga).padEnd(14), String(f.potencia||'—').padEnd(11), String(f.tipo).padEnd(12),
  'SMC', String(f.smc ? f.smc.unidades : '—').padStart(5),
  '| OSPG', String(f.ospg ? f.ospg.unidades : '—').padStart(5),
  '|', f.nivelMatch));

console.log('\n── detalle (drill-down) ──');
const conDosLados = api.getMaestro().find(f => f.smc && f.ospg);
const det = api.getDetalle(conDosLados.clave);
console.log('  clave:', det.clave, '| líneas crudas:', det.lineas.length);
det.resumenPorSistema.forEach(s => console.log('   ', s.sistema, s.unidades, 'un. · total', s.total));

console.log('\n── decisión humana + recruce ──');
const rev = api.getRevision();
console.log('  en cola:', rev.length);
if (rev.length) {
  const x = rev[0];
  console.log('  uniendo:', x.smc.descripcionRaw, '<->', x.ospg.descripcionRaw);
  console.log('  guardado:', JSON.stringify(api.guardarDecision(x.smc.sistema, x.smc.id, x.ospg.sistema, x.ospg.id, 'UNIR')));
  const m2 = api.construirMaestro();
  console.log('  tras recruce -> artículos:', m2.articulos, '| L0:', m2.stats.L0, '| revisión:', m2.enRevision);
}
console.log('\n>>> SMOKE OK');
