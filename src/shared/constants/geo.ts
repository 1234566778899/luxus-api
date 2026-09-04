/** Ubicaciones habituales del mercado peruano de alto patrimonio. */

export interface LocationOption {
  district: string;
  province: string;
  region: string;
  /**
   * Centroide público aproximado del distrito (coordenadas de la plaza o el
   * centro administrativo, no de ningún activo). Es lo único que se muestra
   * en el mapa de Nivel I: la coordenada real del activo vive solo en
   * `asset_private_details` y nunca llega a esta constante.
   */
  lat: number;
  lng: number;
}

export const PERU_PRIME_LOCATIONS: readonly LocationOption[] = [
  { district: 'San Isidro', province: 'Lima', region: 'Lima', lat: -12.0985, lng: -77.0364 },
  { district: 'Miraflores', province: 'Lima', region: 'Lima', lat: -12.1211, lng: -77.0296 },
  { district: 'Barranco', province: 'Lima', region: 'Lima', lat: -12.1494, lng: -77.0203 },
  { district: 'Santiago de Surco', province: 'Lima', region: 'Lima', lat: -12.1350, lng: -76.9931 },
  { district: 'La Molina', province: 'Lima', region: 'Lima', lat: -12.0872, lng: -76.9391 },
  { district: 'San Borja', province: 'Lima', region: 'Lima', lat: -12.1078, lng: -77.0003 },
  { district: 'Chorrillos', province: 'Lima', region: 'Lima', lat: -12.1750, lng: -77.0181 },
  { district: 'Ancón', province: 'Lima', region: 'Lima', lat: -11.7742, lng: -77.1783 },
  { district: 'Asia', province: 'Cañete', region: 'Lima', lat: -12.7789, lng: -76.5806 },
  { district: 'Callao', province: 'Callao', region: 'Callao', lat: -12.0566, lng: -77.1181 },
  { district: 'Paracas', province: 'Pisco', region: 'Ica', lat: -13.8467, lng: -76.2500 },
  { district: 'Subtanjalla', province: 'Ica', region: 'Ica', lat: -14.0264, lng: -75.7397 },
  { district: 'Cusco', province: 'Cusco', region: 'Cusco', lat: -13.5320, lng: -71.9675 },
  { district: 'Urubamba', province: 'Urubamba', region: 'Cusco', lat: -13.3054, lng: -72.1164 },
  { district: 'Arequipa', province: 'Arequipa', region: 'Arequipa', lat: -16.4090, lng: -71.5375 },
  { district: 'Trujillo', province: 'Trujillo', region: 'La Libertad', lat: -8.1116, lng: -79.0288 },
  { district: 'Máncora', province: 'Talara', region: 'Piura', lat: -4.1075, lng: -81.0475 },
  { district: 'Punta Sal', province: 'Contralmirante Villar', region: 'Tumbes', lat: -3.9825, lng: -80.9922 },
];

/** Centroide de distrito por nombre — para el mapa aproximado de Nivel I. */
export const DISTRICT_CENTROIDS: Record<string, { lat: number; lng: number }> =
  Object.fromEntries(PERU_PRIME_LOCATIONS.map((l) => [l.district, { lat: l.lat, lng: l.lng }]));

/** Centro de Lima, usado cuando un distrito no está en la lista anterior. */
export const PERU_DEFAULT_CENTER = { lat: -12.0464, lng: -77.0428 };

export const PERU_REGIONS = [
  ...new Set(PERU_PRIME_LOCATIONS.map((l) => l.region)),
].sort();

/** Tramos de precio para los filtros de colección (USD). */
export const PRICE_BANDS = [
  { key: 'under-1m', label: 'Hasta USD 1M', min: 0, max: 1_000_000 },
  { key: '1m-3m', label: 'USD 1M – 3M', min: 1_000_000, max: 3_000_000 },
  { key: '3m-5m', label: 'USD 3M – 5M', min: 3_000_000, max: 5_000_000 },
  { key: '5m-10m', label: 'USD 5M – 10M', min: 5_000_000, max: 10_000_000 },
  { key: 'over-10m', label: 'Más de USD 10M', min: 10_000_000, max: null },
] as const;

export type PriceBandKey = (typeof PRICE_BANDS)[number]['key'];

export const VISIBILITY_LABELS = {
  verified: 'Verified',
  private: 'Private',
  off_market: 'Off-Market',
} as const;

export const VISIBILITY_DESCRIPTIONS = {
  verified: 'Titularidad acreditada y documentación revisada por LUXUS.',
  private: 'Publicación restringida. Detalles solo para miembros verificados.',
  off_market: 'No se publica. Se comparte con miembros bajo mandato específico.',
} as const;
