import type { AssetCategory } from '../types/database.types.js';

/**
 * Definición declarativa de las specs por categoría.
 *
 * Una sola fuente para tres consumidores:
 *   · el wizard de publicación (qué campos pedir y de qué tipo),
 *   · el "Asset Passport" de la ficha pública (qué mostrar y en qué orden),
 *   · la validación Zod (schemas/asset.ts se genera a partir de aquí).
 */
export type SpecFieldType = 'text' | 'number' | 'select' | 'boolean' | 'tags';

export interface SpecField {
  key: string;
  label: string;
  type: SpecFieldType;
  unit?: string;
  options?: readonly string[];
  required?: boolean;
  /** Grupo del wizard y del passport. */
  group: string;
  /** Si aparece en la tarjeta compacta del listado. */
  card?: boolean;
  /**
   * Calificador breve para la tarjeta cuando el campo no tiene `unit`
   * (p. ej. "dorm.", "asientos"): evita que un número quede sin contexto,
   * al estilo "16 Beds · 10 Baths" de un marketplace de referencia.
   */
  cardUnit?: string;
  help?: string;
}

const COMMON_CONDITION = ['Concours', 'Excelente', 'Muy bueno', 'Bueno', 'A restaurar'] as const;

export const CATEGORY_SPECS: Record<AssetCategory, readonly SpecField[]> = {
  'real-estate': [
    { key: 'property_type', label: 'Tipo de propiedad', type: 'text', required: true, group: 'General', card: true },
    { key: 'bedrooms', label: 'Dormitorios', type: 'number', required: true, group: 'Distribución', card: true, cardUnit: 'dorm.' },
    { key: 'bathrooms', label: 'Baños', type: 'number', required: true, group: 'Distribución', card: true, cardUnit: 'baños' },
    { key: 'parking', label: 'Estacionamientos', type: 'number', group: 'Distribución' },
    { key: 'built_area_m2', label: 'Área construida', type: 'number', unit: 'm²', required: true, group: 'Superficie', card: true },
    { key: 'land_area_m2', label: 'Área de terreno', type: 'number', unit: 'm²', group: 'Superficie' },
    { key: 'terrace_area_m2', label: 'Área de terraza', type: 'number', unit: 'm²', group: 'Superficie' },
    { key: 'floors', label: 'Niveles', type: 'number', group: 'Distribución' },
    { key: 'year_built', label: 'Año de construcción', type: 'number', group: 'General' },
    { key: 'renovation_year', label: 'Año de remodelación', type: 'number', group: 'General' },
    { key: 'view', label: 'Vista', type: 'text', group: 'Entorno' },
    { key: 'condition', label: 'Estado', type: 'select', options: COMMON_CONDITION, group: 'General' },
    { key: 'furnished', label: 'Amoblado', type: 'text', group: 'General' },
    { key: 'hectares_in_production', label: 'Hectáreas en producción', type: 'number', unit: 'ha', group: 'Agrícola' },
    { key: 'water_rights', label: 'Derechos de agua acreditados', type: 'boolean', group: 'Agrícola' },
    { key: 'amenities', label: 'Servicios y equipamiento', type: 'tags', group: 'Entorno' },
  ],
  companies: [
    { key: 'sector', label: 'Sector', type: 'text', required: true, group: 'General', card: true },
    { key: 'legal_form', label: 'Forma societaria', type: 'select', options: ['S.A.', 'S.A.C.', 'S.R.L.', 'E.I.R.L.', 'Sucursal'], group: 'General' },
    { key: 'year_founded', label: 'Año de constitución', type: 'number', group: 'General' },
    { key: 'employees', label: 'Colaboradores', type: 'number', group: 'Operación', card: true, cardUnit: 'colab.' },
    { key: 'revenue_ttm_usd', label: 'Ingresos (UDM)', type: 'number', unit: 'USD', required: true, group: 'Financiero', card: true },
    { key: 'ebitda_ttm_usd', label: 'EBITDA (UDM)', type: 'number', unit: 'USD', required: true, group: 'Financiero' },
    { key: 'ebitda_margin', label: 'Margen EBITDA', type: 'number', unit: '%', group: 'Financiero' },
    { key: 'recurring_revenue_pct', label: 'Ingresos recurrentes', type: 'number', unit: '%', group: 'Financiero' },
    { key: 'customers', label: 'Clientes activos', type: 'number', group: 'Operación' },
    { key: 'stake_offered_pct', label: 'Participación ofrecida', type: 'number', unit: '%', required: true, group: 'Transacción', card: true },
    { key: 'transaction_type', label: 'Tipo de operación', type: 'text', group: 'Transacción' },
    { key: 'warehouse_m2', label: 'Superficie operativa', type: 'number', unit: 'm²', group: 'Operación' },
    { key: 'properties', label: 'Establecimientos', type: 'number', group: 'Operación' },
    { key: 'keys', label: 'Habitaciones / llaves', type: 'number', group: 'Operación' },
    { key: 'average_occupancy_pct', label: 'Ocupación media', type: 'number', unit: '%', group: 'Operación' },
    { key: 'licenses', label: 'Licencias y autorizaciones', type: 'tags', group: 'Regulatorio' },
  ],
  vehicles: [
    { key: 'make', label: 'Marca', type: 'text', required: true, group: 'General', card: true },
    { key: 'model', label: 'Modelo', type: 'text', required: true, group: 'General', card: true },
    { key: 'year', label: 'Año', type: 'number', required: true, group: 'General', card: true },
    { key: 'mileage_km', label: 'Kilometraje', type: 'number', unit: 'km', required: true, group: 'Uso', card: true },
    { key: 'engine', label: 'Motor', type: 'text', group: 'Mecánica' },
    { key: 'power_hp', label: 'Potencia', type: 'number', unit: 'hp', group: 'Mecánica' },
    { key: 'transmission', label: 'Transmisión', type: 'text', group: 'Mecánica' },
    { key: 'drivetrain', label: 'Tracción', type: 'select', options: ['RWD', 'FWD', 'AWD', '4WD'], group: 'Mecánica' },
    { key: 'exterior_color', label: 'Color exterior', type: 'text', group: 'Acabados' },
    { key: 'interior_color', label: 'Interior', type: 'text', group: 'Acabados' },
    { key: 'condition', label: 'Estado', type: 'select', options: COMMON_CONDITION, group: 'General' },
    { key: 'matching_numbers', label: 'Matching numbers', type: 'boolean', group: 'Procedencia' },
    { key: 'production_units', label: 'Unidades producidas', type: 'number', group: 'Procedencia' },
    { key: 'provenance', label: 'Procedencia', type: 'text', group: 'Procedencia' },
  ],
  yachts: [
    { key: 'builder', label: 'Astillero', type: 'text', required: true, group: 'General', card: true },
    { key: 'model', label: 'Modelo', type: 'text', required: true, group: 'General', card: true },
    { key: 'year', label: 'Año', type: 'number', required: true, group: 'General', card: true },
    { key: 'refit_year', label: 'Año de refit', type: 'number', group: 'General' },
    { key: 'length_m', label: 'Eslora', type: 'number', unit: 'm', required: true, group: 'Dimensiones', card: true },
    { key: 'beam_m', label: 'Manga', type: 'number', unit: 'm', group: 'Dimensiones' },
    { key: 'draft_m', label: 'Calado', type: 'number', unit: 'm', group: 'Dimensiones' },
    { key: 'cabins', label: 'Cabinas', type: 'number', required: true, group: 'Acomodación', card: true, cardUnit: 'cabinas' },
    { key: 'berths', label: 'Plazas', type: 'number', group: 'Acomodación' },
    { key: 'crew', label: 'Tripulación', type: 'number', group: 'Acomodación' },
    { key: 'engines', label: 'Motorización', type: 'text', group: 'Mecánica' },
    { key: 'engine_hours', label: 'Horas de motor', type: 'number', unit: 'h', group: 'Mecánica' },
    { key: 'cruising_speed_kn', label: 'Velocidad de crucero', type: 'number', unit: 'kn', group: 'Prestaciones' },
    { key: 'max_speed_kn', label: 'Velocidad máxima', type: 'number', unit: 'kn', group: 'Prestaciones' },
    { key: 'range_nm', label: 'Autonomía', type: 'number', unit: 'nm', group: 'Prestaciones' },
    { key: 'flag', label: 'Bandera', type: 'text', group: 'Registro' },
    { key: 'hull_material', label: 'Material del casco', type: 'text', group: 'Construcción' },
    { key: 'tender', label: 'Tender', type: 'text', group: 'Equipamiento' },
    { key: 'includes_berth', label: 'Incluye amarre', type: 'boolean', group: 'Equipamiento' },
  ],
  aircraft: [
    { key: 'manufacturer', label: 'Fabricante', type: 'text', required: true, group: 'General', card: true },
    { key: 'model', label: 'Modelo', type: 'text', required: true, group: 'General', card: true },
    { key: 'year', label: 'Año', type: 'number', required: true, group: 'General', card: true },
    { key: 'total_time_hours', label: 'Horas totales', type: 'number', unit: 'h', required: true, group: 'Uso', card: true },
    { key: 'cycles', label: 'Ciclos', type: 'number', group: 'Uso' },
    { key: 'seats', label: 'Asientos', type: 'number', required: true, group: 'Configuración', card: true, cardUnit: 'asientos' },
    { key: 'range_nm', label: 'Alcance', type: 'number', unit: 'nm', group: 'Prestaciones' },
    { key: 'engines', label: 'Motorización', type: 'text', group: 'Mecánica' },
    { key: 'avionics', label: 'Aviónica', type: 'text', group: 'Sistemas' },
    { key: 'connectivity', label: 'Conectividad', type: 'text', group: 'Sistemas' },
    { key: 'maintenance_program', label: 'Programa de mantenimiento', type: 'text', group: 'Mantenimiento' },
    { key: 'interior_year', label: 'Año del interior', type: 'number', group: 'Configuración' },
    { key: 'exterior_year', label: 'Año de pintura', type: 'number', group: 'Configuración' },
    { key: 'registration_country', label: 'País de matrícula', type: 'text', group: 'Registro' },
    { key: 'home_base', label: 'Base operativa', type: 'text', group: 'Registro' },
    { key: 'high_altitude_kit', label: 'Configuración de altura', type: 'boolean', group: 'Configuración' },
  ],
};

export function specFieldsFor(category: AssetCategory): readonly SpecField[] {
  return CATEGORY_SPECS[category];
}

export function cardSpecsFor(category: AssetCategory): readonly SpecField[] {
  return CATEGORY_SPECS[category].filter((f) => f.card);
}
