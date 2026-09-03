import type { SubscriptionKind } from '../types/database.types.js';

export interface PlanDefinition {
  code: string;
  kind: SubscriptionKind;
  name: string;
  tagline: string;
  amountCents: number;
  currency: 'USD';
  interval: 'month' | 'year';
  listingQuota: number | null;
  benefits: readonly string[];
  highlight?: boolean;
}

/**
 * Espejo de la tabla `plans`. Se usa para render estático de la página de
 * membresías sin consultar la base de datos; los importes de cobro reales
 * siempre salen de Stripe.
 */
export const MEMBERSHIP_PLANS: readonly PlanDefinition[] = [
  {
    code: 'membership_private', kind: 'membership', name: 'LUXUS PRIVATE',
    tagline: 'Acceso al mercado privado curado.',
    amountCents: 150_000, currency: 'USD', interval: 'year', listingQuota: null,
    benefits: [
      'Acceso a activos verificados',
      'Hasta 3 Deal Rooms simultáneos',
      'Reportes Intelligence',
      'Alertas de nuevos activos',
    ],
  },
  {
    code: 'membership_black', kind: 'membership', name: 'LUXUS BLACK',
    tagline: 'Acceso anticipado y mercado off-market.',
    amountCents: 500_000, currency: 'USD', interval: 'year', listingQuota: null,
    highlight: true,
    benefits: [
      'Todo LUXUS PRIVATE',
      'Acceso anticipado 72 h antes de la publicación',
      'Activos off-market',
      'Deal Rooms ilimitados',
      'Analista asignado',
    ],
  },
  {
    code: 'membership_family_office', kind: 'membership', name: 'LUXUS FAMILY OFFICE',
    tagline: 'Mandato de búsqueda y concierge dedicado.',
    amountCents: 1_500_000, currency: 'USD', interval: 'year', listingQuota: null,
    benefits: [
      'Todo LUXUS BLACK',
      'Concierge de transacción dedicado',
      'Mandatos de búsqueda a medida',
      'Originación off-market bajo pedido',
      'Hasta 5 usuarios de la oficina',
    ],
  },
];

export const BROKER_PLANS: readonly PlanDefinition[] = [
  {
    code: 'broker_essential', kind: 'broker', name: 'Essential',
    tagline: 'Para brókers independientes.',
    amountCents: 25_000, currency: 'USD', interval: 'month', listingQuota: 3,
    benefits: ['Hasta 3 activos publicados', 'Perfil de bróker', 'Deal Room estándar'],
  },
  {
    code: 'broker_professional', kind: 'broker', name: 'Professional',
    tagline: 'Para equipos con cartera activa.',
    amountCents: 75_000, currency: 'USD', interval: 'month', listingQuota: 12,
    highlight: true,
    benefits: [
      'Hasta 12 activos publicados',
      'Badge LUXUS VERIFIED',
      'Posicionamiento destacado en colecciones',
      'Estadísticas avanzadas',
    ],
  },
  {
    code: 'broker_private_desk', kind: 'broker', name: 'Private Desk',
    tagline: 'Mesa privada con originación conjunta.',
    amountCents: 200_000, currency: 'USD', interval: 'month', listingQuota: null,
    benefits: [
      'Activos ilimitados',
      'Prioridad máxima de posicionamiento',
      'Originación conjunta off-market',
      'Soporte de verificación acelerado',
    ],
  },
];

export const ALL_PLANS = [...MEMBERSHIP_PLANS, ...BROKER_PLANS];

export const LISTING_FEE_BANDS = {
  private: { minCents: 50_000, maxCents: 200_000, label: 'Private' },
  signature: { minCents: 200_000, maxCents: 1_000_000, label: 'Signature' },
} as const;

export function planByCode(code: string): PlanDefinition | undefined {
  return ALL_PLANS.find((p) => p.code === code);
}
