/**
 * Contrato del proveedor de screening: PEP, listas de sanciones y adverse media.
 * Se ejecuta al aprobar el KYC y deja su resultado en el perfil.
 */

export interface ScreeningSubject {
  userId: string;
  fullName: string;
  documentNumber?: string | null;
  birthDate?: string | null;
  nationality?: string | null;
  country?: string | null;
}

export interface ScreeningMatch {
  list: string;
  matchedName: string;
  score: number;
  category: 'pep' | 'sanction' | 'adverse_media' | 'law_enforcement';
  details?: string;
  sourceUrl?: string;
}

export type ScreeningVerdict = 'clear' | 'flagged' | 'blocked';

export interface ScreeningResult {
  provider: string;
  providerRef: string;
  verdict: ScreeningVerdict;
  listsChecked: string[];
  matches: ScreeningMatch[];
  riskScore: number;
  raw: Record<string, unknown>;
}

export interface ScreeningProvider {
  readonly name: string;
  screen(subject: ScreeningSubject): Promise<ScreeningResult>;
}
