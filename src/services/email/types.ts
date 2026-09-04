/** Contrato del proveedor de correo transaccional (Resend, SendGrid, SES…). */

export type EmailTemplate =
  | 'private_access_approved'
  | 'private_access_rejected'
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'kyc_manual_review'
  | 'deal_access_requested'
  | 'deal_access_approved'
  | 'deal_access_declined'
  | 'nda_pending'
  | 'nda_signed'
  | 'qa_new_message'
  | 'offer_received'
  | 'offer_response'
  | 'loi_ready'
  | 'permission_expiring'
  | 'permission_expired'
  | 'asset_published'
  | 'asset_changes_requested'
  | 'payment_receipt'
  | 'subscription_past_due';

export interface EmailMessage {
  to: string;
  template: EmailTemplate;
  subject: string;
  /** Datos que rellenan la plantilla. */
  data: Record<string, unknown>;
  replyTo?: string;
  userId?: string | null;
}

export interface EmailSendResult {
  provider: string;
  providerRef: string | null;
  status: 'sent' | 'queued' | 'skipped' | 'failed';
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage, html: string, text: string): Promise<EmailSendResult>;
}
