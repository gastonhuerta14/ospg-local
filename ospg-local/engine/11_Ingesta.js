function ingestarFuente_(indice, dic) {
  const inicio = Date.now();
  const fuente = FUENTES[indice];
  if (!fuente) throw new Error("Índice de fuente inválido: " + indice);
  
  const fileId = localizarArchivo_(fuente);
  if (!fileId) return { id: fuente.id, sistema: fuente.sistema, encontrado: false, estado: 'FALTANTE', error: 'No se encontró archivo que coincida con el patrón.' };
  
  const data = leerExcelConvertido_(fileId);
  if (!data || data.length < 2) throw new Error("El archivo está vacío o sin datos.");
  
  let headerRowIdx = -1, maxColsFound = 0, mapCols = {};
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    let found = 0, tempMap = {};
    for (const key in fuente.cols) {
      const patrones = fuente.cols[key];
      for (let c = 0; c < row.length; c++) {
        if (patrones.some(p => p.test(normalizar_(row[c])))) {
          tempMap[key] = { index: c, name: row[c] };
          found++; break;
        }
      }
    }
    if (found > maxColsFound) { maxColsFound = found; headerRowIdx = i; mapCols = tempMap; }
  }
  
  if (headerRowIdx === -1) throw new Error("No se detectaron encabezados válidos.");
  const colsNoEncontradas = Object.keys(fuente.cols).filter(k => !mapCols[k]);
  const registros = [];
  
  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const row = data[i];
    const getVal = key => mapCols[key] ? row[mapCols[key].index] : null;
    const rawDesc = getVal('desc');
    if (!rawDesc) continue;
    
    // Llamada al NUEVO mega-parser
    const record = parsearDescripcion_(rawDesc, getVal('pa'), dic, getVal('cod'));
    
    record.id = fuente.id + '#' + (i + 1);
    record.fuente = fuente.id;
    record.sistema = fuente.sistema;
    record.lado = fuente.lado;
    record.fila = i + 1;
    record.descripcionRaw = rawDesc;
    record.marca = getVal('marca');
    record.proveedor = getVal('proveedor');
    record.cantidadEnvases = getVal('cant');
    record.precioEnvase = getVal('precio');
    
    calcularLinea_(record);
    registros.push(record);
  }
  
  const colsMapeadasTexto = {};
  for(let k in mapCols) colsMapeadasTexto[k] = mapCols[k].name;

  return {
    archivo: DriveApp.getFileById(fileId).getName(), id: fuente.id, sistema: fuente.sistema, encontrado: true, estado: 'OK',
    filasLeidas: data.length - headerRowIdx - 1, registrosValidos: registros.length,
    columnasMapeadas: colsMapeadasTexto, columnasNoEncontradas: colsNoEncontradas,
    calidad: {}, duracionMs: Date.now() - inicio, datos: registros
  };
}