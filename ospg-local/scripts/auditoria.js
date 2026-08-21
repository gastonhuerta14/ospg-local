// Corre 90_Auditoria.js contra el motor cargado localmente.
//   npm run auditoria
const path = require('node:path');
const { crearApi } = require('../src/api');
crearApi({ raiz: path.join(__dirname, '..'), usuario: 'local@ospg' }).auditoria();
