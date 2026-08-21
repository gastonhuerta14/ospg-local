const CFG = {
  PERIODO: '2026-06',
  DRIVE_ROOT_ID: '18R4rL9qow0Ee284utivu8uXApebElu8_', // Tu ID 
  CONTROL_SHEET_ID: '1B294P4Jpa0eFTJ3m1ximuCzVSoCFNlVu6EbPmiXCR6E', // Asegurate de que el ID sea el de tu planilla
  UMBRAL_AUTO: 92,          
  UMBRAL_REVISION: 65,      // Bajado de 80: las parciales van a la cola humana, no al vacío
  UMBRAL_AUTO_SIN_DISC: 96, // NUEVO: Umbral estricto para cosas como "GASA X 100" sin medida
  IVA: 0,                   
  PRECIO_INCLUYE_IVA: true,
  MAX_CANDIDATOS: 50,
  PRESUPUESTO_MS: 240000
};

const FUENTES = [
  { id: 'GECLISA_ACOPIO',       sistema: 'GECLISA', lado: 'OSPG',
    patron: /geclisa.*acopio/i,
    cols: { desc: [/^COD\s*\+?\s*DESC/i, /DESCRIP/i],
            cant: [/COMPRA\s*MENSUAL/i, /^CANT/i],
            precio: [/ULTIMO\s*PRECIO/i, /PRECIO/i],
            pa: [], proveedor: [/PROVEE/i], marca: [/MARCA/i, /LABORAT/i] } },

  { id: 'GECLISA_HOSPITALARIO',  sistema: 'GECLISA', lado: 'OSPG',
    patron: /geclisa.*hospital/i,
    cols: { desc: [/^COD\s*\+?\s*DESC/i, /DESCRIP/i],
            cant: [/COMPRA\s*MENSUAL/i, /^CANT/i],
            precio: [/ULTIMO\s*PRECIO/i, /PRECIO/i],
            pa: [], proveedor: [/PROVEE/i], marca: [/MARCA/i, /LABORAT/i] } },

  { id: 'SAES_ALTO_COSTO',       sistema: 'SAES', lado: 'OSPG',
    patron: /saes.*(alto|costo)/i,
    cols: { desc: [/MEDICAMENTO/i, /PRESENTACION/i],
            cant: [/COMPRA\s*MENSUAL/i, /^CANT/i],
            precio: [/ULTIMO\s*PRECIO/i, /PRECIO/i],
            pa: [/MONODROGA/i],                     
            proveedor: [/PROVEE/i], marca: [/MARCA/i, /LABORAT/i] } },

  { id: 'SAES_INSULINAS',        sistema: 'SAES', lado: 'OSPG',
    patron: /saes.*insulina/i,
    cols: { desc: [/MEDICAMENTO/i, /PRESENTACION/i],
            cant: [/COMPRA\s*MENSUAL/i, /^CANT/i],
            precio: [/ULTIMO\s*PRECIO/i, /PRECIO/i],
            pa: [], proveedor: [/PROVEE/i], marca: [/MARCA/i, /LABORAT/i] } },

  { id: 'SMC_ALTO_COSTO',        sistema: 'SMC', lado: 'SMC',
    patron: /smc.*(alto|costo)/i,
    cols: { desc: [/ARTICULO\s*DESCRIP/i, /DESCRIPCION/i],
            cant: [/CANTIDAD/i], precio: [/PRECIO/i],
            pa: [/DROGA/i, /ALFABETA/i],            
            proveedor: [/PROVEEDOR/i], marca: [/MARCA/i] } },

  { id: 'SMC_MEDICAMENTOS',      sistema: 'SMC', lado: 'SMC',
    patron: /smc.*medicamento/i,
    cols: { desc: [/ARTICULO\s*DESCRIP/i, /DESCRIPCION/i],
            cant: [/CANTIDAD/i], precio: [/PRECIO/i],
            pa: [], proveedor: [/PROVEEDOR/i], marca: [/MARCA/i] } }
];