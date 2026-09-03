export * from './categories.js';
export * from './specs.js';
export * from './deal.js';
export * from './plans.js';
export * from './geo.js';

/** Marca. La paleta procede del logotipo corporativo (azul marino + oro). */
export const BRAND = {
  name: 'LUXUS PERÚ',
  legalName: 'LUXUS PERÚ S.A.C.',
  claim: 'Exceptional Assets. Private Transactions.',
  claimEs: 'Activos excepcionales. Transacciones privadas.',
  email: 'private@luxusperu.com',
  phone: '+51 987 200 100',
  address: 'Av. Santa Cruz 1250, San Isidro, Lima, Perú',
  ruc: '20600000000',
  colors: {
    // Blanco dominante, tipografía casi negra, acento único verde azulado —
    // el mismo lenguaje visual de un marketplace de lujo de referencia.
    navy: '#181818',
    navyDeep: '#0A0A0A',
    gold: '#0F6E6E',
    goldLight: '#15908A',
    ivory: '#FAFAFA',
    stone: '#E5E5E5',
  },
} as const;

export const TRUST_PILLARS = [
  { key: 'verified', title: 'Verified', body: 'Titularidad y situación registral revisadas antes de publicar.' },
  { key: 'confidential', title: 'Confidential', body: 'Precio exacto, ubicación y documentación solo bajo NDA.' },
  { key: 'curated', title: 'Curated', body: 'Inventario limitado. Cada activo entra por evaluación, no por catálogo.' },
  { key: 'secure', title: 'Secure', body: 'Deal Room auditado, marca de agua dinámica y accesos con vencimiento.' },
] as const;

/** Vida de las URL firmadas de documentos (segundos). */
export const SIGNED_URL_TTL_SECONDS = 300;
