import type { AssetCategory } from '../types/database.types.js';

export const ASSET_CATEGORIES = [
  'real-estate', 'companies', 'vehicles', 'yachts', 'aircraft',
] as const satisfies readonly AssetCategory[];

export interface CategoryMeta {
  slug: AssetCategory;
  label: string;
  labelEn: string;
  singular: string;
  /** Frase corta para la portada de la colección. */
  tagline: string;
  intro: string;
}

export const CATEGORY_META: Record<AssetCategory, CategoryMeta> = {
  'real-estate': {
    slug: 'real-estate',
    label: 'Inmuebles',
    labelEn: 'Real Estate',
    singular: 'Inmueble',
    tagline: 'Residencias, haciendas y suelo de excepción.',
    intro:
      'Propiedades con titularidad acreditada y situación registral revisada. La ubicación exacta y el precio de referencia se comparten únicamente con miembros verificados.',
  },
  companies: {
    slug: 'companies',
    label: 'Empresas',
    labelEn: 'Companies',
    singular: 'Empresa',
    tagline: 'Participaciones societarias y operaciones de M&A.',
    intro:
      'Compañías en operación cuyos accionistas evalúan una transferencia total o parcial. Los estados financieros se revisan dentro del Deal Room, previa firma de NDA.',
  },
  vehicles: {
    slug: 'vehicles',
    label: 'Vehículos',
    labelEn: 'Vehicles',
    singular: 'Vehículo',
    tagline: 'Automóviles de colección y series limitadas.',
    intro:
      'Unidades con procedencia documentada, registro vehicular verificado y certificado de gravámenes revisado.',
  },
  yachts: {
    slug: 'yachts',
    label: 'Yates',
    labelEn: 'Yachts',
    singular: 'Yate',
    tagline: 'Embarcaciones con matrícula y navegabilidad al día.',
    intro:
      'Yates y embarcaciones deportivas con matrícula DICAPI vigente y certificados de navegabilidad revisados.',
  },
  aircraft: {
    slug: 'aircraft',
    label: 'Aeronaves',
    labelEn: 'Aircraft',
    singular: 'Aeronave',
    tagline: 'Aviación ejecutiva y helicópteros.',
    intro:
      'Aeronaves con matrícula DGAC vigente, logbooks completos y programa de mantenimiento acreditado.',
  },
};

export const CATEGORY_ORDER = ASSET_CATEGORIES;

export function isAssetCategory(value: string): value is AssetCategory {
  return (ASSET_CATEGORIES as readonly string[]).includes(value);
}
