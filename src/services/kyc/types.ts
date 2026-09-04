/**
 * Contrato del proveedor de verificación de identidad (KYC).
 *
 * La plataforma no implementa verificación documental propia. Este contrato
 * está pensado para conectar un proveedor peruano con acceso a RENIEC a través
 * de un tercero autorizado (la consulta directa a RENIEC no está abierta a
 * privados). Sustituir la implementación mock por la real no debe requerir
 * cambios fuera de esta carpeta.
 */

export interface KycSubject {
  userId: string;
  legalName: string;
  documentType: 'DNI' | 'CE' | 'PASSPORT';
  documentNumber: string;
  nationality: string;
  birthDate: string;
  email: string;
  phone?: string | null;
}

export interface KycDocumentRef {
  docType: string;
  bucket: string;
  storagePath: string;
  mimeType?: string | null;
}

export type KycVerdict = 'approved' | 'rejected' | 'manual_review';

export interface KycCheckResult {
  provider: string;
  providerRef: string;
  verdict: KycVerdict;
  /** 0–100; a mayor valor, mayor riesgo. */
  riskScore: number;
  reasons: string[];
  /** Coincidencia declarado ↔ documento, cuando el proveedor la reporta. */
  documentMatch?: boolean;
  livenessPassed?: boolean;
  raw: Record<string, unknown>;
}

export interface KycProvider {
  readonly name: string;
  /** Envía el caso a verificación y devuelve el veredicto del proveedor. */
  verify(subject: KycSubject, documents: KycDocumentRef[]): Promise<KycCheckResult>;
  /** Consulta el estado de un caso ya enviado (proveedores asíncronos). */
  fetchStatus(providerRef: string): Promise<KycCheckResult | null>;
}
