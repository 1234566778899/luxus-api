/**
 * Contrato del proveedor de firma electrónica.
 *
 * Pensado para conectar un proveedor con validez legal en Perú al amparo de la
 * Ley 27269 (Ley de Firmas y Certificados Digitales) y su reglamento: una
 * Entidad de Certificación acreditada ante INDECOPI, o un proveedor
 * internacional que emita firma electrónica avanzada con constancia de
 * conservación. La plataforma NO emite certificados ni valida su cadena.
 */

export interface SignatureSigner {
  name: string;
  email: string;
  role: 'buyer' | 'seller' | 'witness';
  documentNumber?: string | null;
}

export interface SignatureRequest {
  /** Identificador propio para correlacionar el webhook. */
  referenceId: string;
  documentTitle: string;
  /** PDF a firmar. */
  pdf: Uint8Array;
  signers: SignatureSigner[];
  expiresInDays: number;
  callbackUrl: string;
  metadata?: Record<string, string>;
}

export interface SignatureEnvelope {
  provider: string;
  envelopeId: string;
  status: 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';
  /** URL a la que se envía al firmante. */
  signingUrl?: string;
  sentAt?: string;
  raw: Record<string, unknown>;
}

export interface SignedDocument {
  envelopeId: string;
  pdf: Uint8Array;
  sha256: string;
  signedAt: string;
  signerName: string;
  signerEmail: string;
  auditTrail: Record<string, unknown>;
}

export interface EsignWebhookEvent {
  envelopeId: string;
  referenceId?: string;
  type: 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';
  occurredAt: string;
  signerName?: string;
  signerEmail?: string;
  raw: Record<string, unknown>;
}

export interface EsignProvider {
  readonly name: string;
  createEnvelope(request: SignatureRequest): Promise<SignatureEnvelope>;
  getEnvelope(envelopeId: string): Promise<SignatureEnvelope | null>;
  downloadSigned(envelopeId: string): Promise<SignedDocument | null>;
  /** Valida la firma del webhook y normaliza el evento. */
  parseWebhook(rawBody: string, signature: string | undefined, secret: string): EsignWebhookEvent;
}
