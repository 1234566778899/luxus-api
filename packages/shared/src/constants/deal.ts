import type { DealStage, DocumentFolder } from '../types/database.types.js';

export interface StageMeta {
  stage: DealStage;
  label: string;
  description: string;
  /** Posición en la línea de tiempo; los estados terminales usan -1. */
  step: number;
  /** Quién debe actuar a continuación. */
  actor: 'buyer' | 'seller' | 'platform' | 'both' | 'none';
}

export const DEAL_STAGE_META: Record<DealStage, StageMeta> = {
  requested: {
    stage: 'requested', label: 'Solicitud enviada', step: 1, actor: 'platform',
    description: 'El comprador solicitó acceso al Deal Room.',
  },
  kyc_review: {
    stage: 'kyc_review', label: 'Validación de identidad', step: 2, actor: 'platform',
    description: 'LUXUS verifica el KYC y el screening del comprador.',
  },
  seller_review: {
    stage: 'seller_review', label: 'Revisión del vendedor', step: 3, actor: 'seller',
    description: 'El vendedor evalúa la solicitud y decide si concede acceso.',
  },
  nda_pending: {
    stage: 'nda_pending', label: 'NDA pendiente de firma', step: 4, actor: 'buyer',
    description: 'Acuerdo de confidencialidad emitido, a la espera de firma.',
  },
  nda_signed: {
    stage: 'nda_signed', label: 'Deal Room abierto', step: 5, actor: 'both',
    description: 'NDA ejecutado. El comprador accede a la documentación autorizada.',
  },
  qa: {
    stage: 'qa', label: 'Preguntas y respuestas', step: 6, actor: 'both',
    description: 'Intercambio documental y aclaraciones dentro del Deal Room.',
  },
  offer: {
    stage: 'offer', label: 'Oferta', step: 7, actor: 'both',
    description: 'Existe una oferta formal en negociación.',
  },
  loi: {
    stage: 'loi', label: 'Carta de intención', step: 8, actor: 'both',
    description: 'Términos acordados recogidos en una LOI enviada a firma.',
  },
  due_diligence: {
    stage: 'due_diligence', label: 'Due diligence confirmatoria', step: 9, actor: 'buyer',
    description: 'Revisión confirmatoria con asesores del comprador.',
  },
  closing: {
    stage: 'closing', label: 'Cierre', step: 10, actor: 'both',
    description: 'Checklist de cierre. El escrow es externo a la plataforma.',
  },
  closed: {
    stage: 'closed', label: 'Cerrado', step: 11, actor: 'none',
    description: 'Transacción concluida entre las partes.',
  },
  declined: {
    stage: 'declined', label: 'Denegado', step: -1, actor: 'none',
    description: 'El vendedor no concedió acceso.',
  },
  withdrawn: {
    stage: 'withdrawn', label: 'Retirado', step: -1, actor: 'none',
    description: 'El comprador retiró la solicitud.',
  },
  expired: {
    stage: 'expired', label: 'Vencido', step: -1, actor: 'none',
    description: 'El acceso venció por plazo.',
  },
};

/** Etapas en las que el Deal Room está accesible para el comprador. */
export const OPEN_DEAL_STAGES: readonly DealStage[] = [
  'nda_signed', 'qa', 'offer', 'loi', 'due_diligence', 'closing', 'closed',
];

export const TERMINAL_DEAL_STAGES: readonly DealStage[] = ['closed', 'declined', 'withdrawn', 'expired'];

/**
 * Transiciones permitidas. La API es la única que puede moverlas y valida
 * además quién es el actor legítimo de cada salto.
 */
export const DEAL_TRANSITIONS: Record<DealStage, readonly DealStage[]> = {
  requested: ['kyc_review', 'declined', 'withdrawn'],
  kyc_review: ['seller_review', 'declined', 'withdrawn'],
  seller_review: ['nda_pending', 'declined', 'withdrawn'],
  nda_pending: ['nda_signed', 'declined', 'withdrawn', 'expired'],
  nda_signed: ['qa', 'offer', 'withdrawn', 'expired'],
  qa: ['offer', 'withdrawn', 'expired'],
  offer: ['loi', 'qa', 'withdrawn', 'expired'],
  loi: ['due_diligence', 'offer', 'withdrawn', 'expired'],
  due_diligence: ['closing', 'withdrawn', 'expired'],
  closing: ['closed', 'withdrawn', 'expired'],
  closed: [],
  declined: [],
  withdrawn: [],
  expired: [],
};

export function canTransition(from: DealStage, to: DealStage): boolean {
  return DEAL_TRANSITIONS[from].includes(to);
}

export function isDealRoomOpen(stage: DealStage): boolean {
  return OPEN_DEAL_STAGES.includes(stage);
}

// ── Carpetas del árbol documental ──────────────────────────────────────────
export const DOCUMENT_FOLDERS = [
  'corporate', 'financial', 'legal', 'tax', 'technical', 'commercial',
] as const satisfies readonly DocumentFolder[];

export const FOLDER_META: Record<DocumentFolder, { label: string; description: string }> = {
  corporate: { label: 'Corporate', description: 'Constitución, estatutos, poderes y estructura societaria.' },
  financial: { label: 'Financial', description: 'Estados financieros, proyecciones y deuda.' },
  legal: { label: 'Legal', description: 'Contratos, litigios, licencias y contingencias.' },
  tax: { label: 'Tax', description: 'Situación tributaria y declaraciones.' },
  technical: { label: 'Technical', description: 'Planos, inspecciones, inventarios y peritajes.' },
  commercial: { label: 'Commercial', description: 'Clientes, tarifario, márgenes y pipeline.' },
};

/** Vencimientos que el vendedor puede elegir al conceder un permiso. */
export const PERMISSION_EXPIRY_OPTIONS = [
  { days: 7, label: '7 días' },
  { days: 14, label: '14 días' },
  { days: 30, label: '30 días' },
  { days: 60, label: '60 días' },
  { days: 90, label: '90 días' },
  { days: 0, label: 'Sin vencimiento' },
] as const;

export const CLOSING_CHECKLIST_TEMPLATE = [
  { key: 'definitive_agreement', label: 'Contrato definitivo firmado', owner: 'both' },
  { key: 'escrow_setup', label: 'Escrow abierto con entidad fiduciaria externa', owner: 'buyer' },
  { key: 'conditions_precedent', label: 'Condiciones precedentes cumplidas', owner: 'both' },
  { key: 'regulatory', label: 'Comunicaciones regulatorias presentadas', owner: 'seller' },
  { key: 'transfer', label: 'Transferencia de titularidad inscrita', owner: 'seller' },
  { key: 'closing_date', label: 'Fecha de cierre confirmada', owner: 'both' },
] as const;
