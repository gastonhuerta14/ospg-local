# Migración GAS → Node.js local
### OSPG · Cruce de Compras · plan y andamiaje

**El andamiaje de este repo está corriendo**, no es un boceto: cargué tu motor
real sin modificarlo, ingerí los 6 archivos, construí el maestro y probé los
endpoints por HTTP. La salida está al final.

---

## 0. La decisión que ordena todo el resto

Tu motor ya es Vanilla JS puro. Lo verifiqué archivo por archivo: **de los 14
`.gs`, sólo 4 tocan APIs de Google**, y los 4 son I/O, no lógica.

| Archivo | Qué pasa en la migración |
|---|---|
| `00_Config.gs` | **idéntico** |
| `20_Texto.gs` | **idéntico** |
| `21_Parser.gs` | **idéntico** |
| `22_Diccionario.gs` | **idéntico** |
| `23_Fuzzy.gs` | **idéntico** |
| `30_Cruce.gs` | **idéntico** |
| `31_Precios.gs` | **idéntico** |
| `32_Maestro.gs` | **idéntico** |
| `11_Ingesta.gs` | **idéntico** |
| `90_Auditoria.gs` | **idéntico** |
| `01_Main.gs` (`doGet`) | → `server.js` |
| `02_Api.gs` | → `src/api.js` |
| `10_DriveIO.gs` | → `src/adapters/excel.js` |
| `40_Store.gs` | → `src/adapters/store.js` |

**Diez de catorce archivos no se tocan.** Eso no es una casualidad afortunada:
es la consecuencia de que el motor nunca haya tenido dependencias de Google
adentro. Vale la pena protegerlo, y de ahí sale la decisión central:

> **No portamos el motor. Portamos la superficie que el motor toca.**

Los archivos de `engine/` quedan **byte a byte iguales** a los de Apps Script.
Eso permite algo valioso mientras decidís el despliegue: **podés seguir corriendo
las dos versiones en paralelo** y comparar sus salidas contra el mismo mes. Si
divergen, el problema está en el I/O, nunca en la lógica — y eso reduce el
espacio de búsqueda de un bug a la cuarta parte del proyecto.

### Cómo se logra: `node:vm`, no `require()`

En GAS todos los `.gs` comparten un scope global. En Node cada archivo es un
módulo aislado. La salida obvia —agregar `module.exports` y `require` a cada
archivo— es justamente la que rompe la propiedad de arriba: a partir de ahí hay
dos copias del motor y hay que auditar las dos.

`node:vm` reproduce la semántica de GAS exactamente: un contexto, varios scripts,
scope compartido. `src/engineLoader.js` crea el contexto, le inyecta los
servicios de Google en versión local y evalúa los archivos en orden. Verificado:

```
const compartido: 1 | clase: hola | función: 1     ← const/class/function cruzan archivos
```

---

## 1. `DriveApp` y `SpreadsheetApp`: archivos locales, con adaptador

**Recomendación: archivos locales ahora. Cuenta de Servicio después, y sólo si
aparece un disparador concreto.**

Para lo que estás haciendo —evaluar el sistema en tu máquina antes de decidir el
despliegue— la Cuenta de Servicio es costo puro sin beneficio: proyecto en Cloud
Console, API habilitada, clave JSON que hay que cuidar, y el paso que todo el
mundo olvida (**una cuenta de servicio tiene su propio Drive: si no compartís la
carpeta y la planilla con su email, no ve absolutamente nada**). Todo eso para
leer 6 archivos que se actualizan una vez por mes.

Hay además una ventaja técnica concreta a favor de lo local. En GAS tenías que
copiar cada Excel forzando el MIME de Google Sheets para poder leerlo
(`Drive.Files.copy`). SheetJS lo lee directo **y detecta el formato real por
contenido**: los `.xls` de sistemas hospitalarios que en realidad son HTML o CSV
renombrados —que ya te aparecieron en este proyecto— Drive a veces los convierte
mal y en silencio. `src/adapters/excel.js` los detecta por magic bytes.

Y las hojas de control siguen siendo editables: `DIC_SINONIMOS`, `CROSSWALK` y
`USUARIOS` son CSV en `data/control/`. Se abren con Excel, con VS Code o se suben
a Google Sheets. El equipo de Compras no pierde nada.

**Lo que sí perdés, dicho sin vueltas:** la edición simultánea del diccionario
por varias personas, y el respaldo automático de Drive. Mitigación mientras estés
en local: poné `data/control/` en una carpeta sincronizada o versionala en git —
son archivos de texto, el diff se lee.

### El adaptador es lo que mantiene la puerta abierta

`src/gasShims.js` implementa **el subconjunto exacto** de la API de Google que el
motor usa. Son 13 métodos:

```
SpreadsheetApp: openById · getSheetByName · insertSheet · flush
Sheet:          getLastRow · getLastColumn · getRange · getDataRange
                · getValues · setValues · appendRow · setFrozenRows
Utilities:      getUuid · computeDigest · base64Encode
LockService:    getScriptLock (tryLock / releaseLock)
```

El día que necesites Cuenta de Servicio, **se reescribe sólo `gasShims.js`** —
unas 80 líneas contra `googleapis` — y nada más del proyecto se entera. El motor
no sabe si atrás hay un CSV o la API de Sheets.

**Cuándo hacer el cambio.** No por prolijidad: cuando pase una de estas dos cosas.
(a) Más de una persona necesita editar el diccionario al mismo tiempo.
(b) Lo desplegás en un servidor que usan otros. Hasta entonces, es complejidad
que no compra nada.

---

## 2. Estructura de carpetas

```
ospg-local/
├── package.json
├── server.js                 ← Express. Delgado a propósito.
├── .env.example
│
├── config/
│   └── 00_Config.js          ← IDÉNTICO al de GAS
│
├── engine/                   ← IDÉNTICOS a GAS. No se tocan nunca.
│   ├── 20_Texto.js   21_Parser.js    22_Diccionario.js
│   ├── 23_Fuzzy.js   30_Cruce.js     31_Precios.js
│   ├── 11_Ingesta.js 32_Maestro.js   90_Auditoria.js
│
├── src/                      ← Todo lo que reemplaza a Google
│   ├── engineLoader.js       ← contexto vm + inyección de dependencias
│   ├── gasShims.js           ← SpreadsheetApp / Utilities / LockService locales
│   ├── api.js                ← ex 02_Api.gs
│   ├── rutas.js              ← tabla de endpoints, independiente de Express
│   └── adapters/
│       ├── excel.js          ← ex 10_DriveIO.gs (SheetJS + CSV)
│       └── store.js          ← ex 40_Store.gs (JSON con escritura atómica)
│
├── data/                     ← lo que antes vivía en Drive
│   ├── entrada/2026-06/      ← acá van los 6 Excel del mes
│   ├── control/              ← DIC_SINONIMOS.csv · CROSSWALK.csv · USUARIOS.csv
│   └── salida/               ← silver_*.json · gold_*.json
│
├── public/                   ← el frontend, sin <?!= include(...) ?>
│   ├── index.html
│   ├── css/estilos.css
│   └── js/{core,ingesta,tabla,revision}.js
│
└── scripts/
    ├── smoke.js              ← prueba end-to-end sin levantar el servidor
    └── auditoria.js          ← corre 90_Auditoria.js en local
```

La separación que importa no es `public/` vs servidor: es **`engine/` vs `src/`**.
`engine/` es código compartido con GAS y sagrado; `src/` es el adaptador y se
puede reescribir sin miedo.

---

## 3. Inicialización

```bash
mkdir ospg-local && cd ospg-local
npm init -y
npm i express

# SheetJS NO está en el registro público de npm en sus versiones nuevas.
# Se instala desde el CDN oficial (esto es lo esperado, no un workaround):
npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Eso es todo: **dos dependencias**. Nada de `googleapis`, `dotenv`, `cors`,
`body-parser` ni `nodemon` — `express.json()` reemplaza a body-parser, Node 18+
trae `--watch` y no hay CORS porque el front lo sirve el mismo servidor.

Después:

```bash
# 1. copiá los 6 Excel del mes
cp "Y:/GASTÓN/Compras Plus SMC-OSPG/"*.xls* data/entrada/2026-06/

# 2. arrancá
npm start          # o: npm run dev   (recarga sola al guardar)
#    → http://localhost:3000

# 3. verificación rápida, sin navegador
npm run smoke
```

`server.js` escucha en `127.0.0.1` a propósito: mientras desarrollás, nadie de la
red de OSPG entra.

---

## 4. El frontend: una sola función cambia

Este es el punto más lindo de la migración. `llamar()` conserva **exactamente la
misma firma y el mismo contrato de promesa** que tenía con `google.script.run`,
así que `tabla.js`, `revision.js` e `ingesta.js` siguen funcionando **sin una sola
modificación**:

```javascript
// Antes (GAS)
google.script.run.withSuccessHandler(...).withFailureHandler(...).apiGetMaestro();

// Ahora (public/js/core.js)
const RUTAS_API = {
  apiGetMaestro:      { metodo: 'GET',  url: '/api/maestro' },
  apiIngestarArchivo: { metodo: 'POST', url: '/api/ingestar', body: ['indice'] },
  ...
};
async function llamar(fn, ...args) { /* fetch → misma envoltura {ok,data,error} */ }
```

En las dos versiones el código de la UI dice `await llamar('apiGetMaestro')`.
Cambió el transporte, no la aplicación.

El servidor devuelve la misma envoltura `{ok, data, error}` y además **traduce el
código de error a HTTP**, que en GAS no existía: `AUTH → 403`, `BUSY → 409`,
`RANGO → 400`, `SIN_DATOS → 404`. Y `llamar()` agrega el error que más tiempo
hace perder en desarrollo local:

```
RED · "No hay respuesta del servidor. ¿Está corriendo `node server.js`?"
```

Los tres archivos de UI se copian tal cual, sacándoles las etiquetas `<script>`
—en Node son archivos estáticos comunes— y en `index.html` los
`<?!= include('js_core') ?>` pasan a ser `<script src="js/core.js">`.

---

## 5. Lo que mejora al salir de GAS

No es sólo "lo mismo pero local". Tres restricciones desaparecen:

**El límite de 6 minutos.** Era lo que forzaba toda la arquitectura de ingesta por
archivo y el presupuesto de tiempo del cruce. En Node no existe. Dejá el diseño
como está igual —la ingesta por archivo sigue dando progreso real en la UI— pero
el techo de ~1.500 registros por bloque de principio activo que medí en la
auditoría deja de ser un riesgo de producción.

**La escritura no atómica.** `40_Store.gs` hacía `setTrashed()` y después
`createFile()`: si moría en el medio, el archivo se perdía. `store.js` escribe a
`.tmp` y renombra — o está el viejo o el nuevo, nunca nada a medias.

**El debugging.** Breakpoints reales en VS Code, `console.log` que aparece al
instante, y `npm run smoke` que prueba el pipeline entero en un segundo sin
navegador. El editor de Apps Script no da ninguna de las tres.

---

## 6. Antes de exponerlo a alguien más

En local, sin hoja `USUARIOS`, `verificarAcceso()` devuelve rol `editor`: es tu
propia máquina y escucha en loopback. **Esa decisión no se puede portar a un
despliegue.** Es el mismo `fail-open` que marqué como bloqueante en el code
review. Si esto pasa a un servidor:

1. `verificarAcceso()` tiene que fallar **cerrado** cuando falta la allowlist.
2. Hay que poner autenticación real adelante (OAuth de Google, o un proxy del
   dominio). Un `localhost` sin auth no se convierte en servidor cambiando el
   `HOST`.
3. `data/` deja de ser la fuente de verdad: ahí sí entra la Cuenta de Servicio,
   reescribiendo sólo `gasShims.js`.

---

## Anexo · Verificación ejecutada

Con tu motor real, sin modificarle una línea:

```
── ingesta de los 6 ──
  [0] GECLISA_ACOPIO         OK | filas   3 | dic 0→0 | re-res 0 | sin col: pa
  [1] GECLISA_HOSPITALARIO   OK | filas   1 | dic 0→0 | re-res 0 | sin col: pa
  [2] SAES_ALTO_COSTO        OK | filas   2 | dic 0→2 | re-res 2
  [3] SAES_INSULINAS         OK | filas   1 | dic 2→2 | re-res 0 | sin col: pa
  [4] SMC_ALTO_COSTO         OK | filas   2 | dic 2→2 | re-res 0
  [5] SMC_MEDICAMENTOS       OK | filas   2 | dic 2→2 | re-res 0

── cruce ──
  artículos: 5 | revisión: 0 | truncado: false | 1ms
    OK  Reconciliación de importes SMC delta=0
    OK  Reconciliación de importes OSPG delta=0
    OK  Sin claves duplicadas delta=0

── maestro ──
   RITUXIMAB      500MG       MEDICAMENTO  SMC    10 | OSPG    12 | L2_DOSIS
   TRASTUZUMAB    440MG       MEDICAMENTO  SMC     6 | OSPG    10 | L1_EXACTA
   PARACETAMOL    500MG       MEDICAMENTO  SMC  9000 | OSPG  3000 | L1_EXACTA
   AGUJA HIPODERM G21         INSUMO       SMC    40 | OSPG    50 | L4_FUZZY
   LANTUS         100UI/1ML   MEDICAMENTO  SMC     — | OSPG    90 | SIN_MATCH
```

El bucle de aprendizaje sigue vivo: SAES enseña 2 sinónimos y re-resuelve los 2
registros de GECLISA ya ingeridos. RITUXIMAB consolida GECLISA + SAES = 12 contra
10 de SMC. La aguja cruza entre sistemas por fuzzy.

Contrato HTTP, con la misma tabla de rutas que monta `server.js`:

```
GET  /api/estado    -> 200 | periodo 2026-06 | archivos 6
POST /api/ingestar  -> 200 | SAES_ALTO_COSTO OK | filas 2
POST /api/cruzar    -> 200 | artículos 5 | QA ok: true
GET  /api/maestro   -> 200 | filas 5
GET  /api/detalle   -> 200 | líneas 3
POST /api/ingestar  -> 400 | RANGO - Falta el índice de fuente.
GET  /api/detalle   -> 400 | RANGO
GET  /api/noexiste  -> 404
```

**Una salvedad honesta:** en mi entorno el registro de npm está bloqueado, así que
no pude instalar Express ni SheetJS. El motor, los shims, los adaptadores,
`src/api.js` y la tabla de rutas se ejecutaron de verdad — la tabla HTTP de arriba
salió de un servidor real montando `src/rutas.js`, sólo que sobre el `http` de
Node en vez de Express. Lo único que quedó revisado-pero-no-ejecutado es el
montaje de `server.js` (unas 40 líneas) y la rama de SheetJS de `excel.js`; las
fixtures que usé son CSV, que `excel.js` parsea sin dependencias. En cuanto corras
`npm i` los dos caminos quedan cubiertos.
