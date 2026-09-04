import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type {
  EsignProvider, EsignWebhookEvent, SignatureEnvelope, SignatureRequest, SignedDocument,
} from './types.js';

/**
 * MOCK: reemplazar por proveedor real.
 *
 * Simula el ciclo de un sobre de firma sin ningún valor legal. Estampa una
 * página de constancia al PDF y calcula su hash para que el resto del sistema
 * (almacenamiento, hash, auditoría, webhook) se pueda probar de extremo a
 * extremo. Las firmas producidas aquí NO son firmas electrónicas.
 */
export class MockEsignProvider implements EsignProvider {
  readonly name = 'mock';

  private envelopes = new Map<string, { request: SignatureRequest; envelope: SignatureEnvelope }>();

  async createEnvelope(request: SignatureRequest): Promise<SignatureEnvelope> {
    // MOCK: reemplazar por proveedor real — POST al proveedor con el PDF y los
    // firmantes; el proveedor devuelve envelopeId y la URL de firma.
    const envelopeId = `mock_env_${createHash('sha256')
      .update(request.referenceId)
      .digest('hex')
      .slice(0, 12)}`;

    const envelope: SignatureEnvelope = {
      provider: this.name,
      envelopeId,
      status: 'sent',
      signingUrl: `${request.callbackUrl}?envelope=${envelopeId}&mock=1`,
      sentAt: new Date().toISOString(),
      raw: {
        note: 'MOCK: sin validez legal. Reemplazar por proveedor acreditado (Ley 27269).',
        signers: request.signers.map((s) => s.email),
        expiresInDays: request.expiresInDays,
      },
    };

    this.envelopes.set(envelopeId, { request, envelope });
    return envelope;
  }

  async getEnvelope(envelopeId: string): Promise<SignatureEnvelope | null> {
    return this.envelopes.get(envelopeId)?.envelope ?? null;
  }

  async downloadSigned(envelopeId: string): Promise<SignedDocument | null> {
    const entry = this.envelopes.get(envelopeId);
    if (!entry) return null;

    const pdf = await PDFDocument.load(entry.request.pdf);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage();
    const { height, width } = page.getSize();
    const signedAt = new Date().toISOString();
    const signer = entry.request.signers[0];

    page.drawText('CONSTANCIA DE FIRMA (SIMULADA)', {
      x: 56, y: height - 80, size: 16, font: bold, color: rgb(0.05, 0.11, 0.2),
    });
    const lines = [
      `Documento: ${entry.request.documentTitle}`,
      `Referencia: ${entry.request.referenceId}`,
      `Sobre: ${envelopeId}`,
      `Firmante: ${signer?.name ?? '—'} <${signer?.email ?? '—'}>`,
      `Fecha: ${signedAt}`,
      '',
      'ADVERTENCIA: constancia generada por un proveedor simulado.',
      'No constituye firma electrónica ni tiene efectos legales.',
      'Sustituir por una Entidad de Certificación acreditada (Ley 27269).',
    ];
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: 56, y: height - 120 - i * 18, size: 10, font,
        color: rgb(0.25, 0.25, 0.25), maxWidth: width - 112,
      });
    });

    const bytes = await pdf.save();
    entry.envelope.status = 'signed';

    return {
      envelopeId,
      pdf: bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      signedAt,
      signerName: signer?.name ?? '',
      signerEmail: signer?.email ?? '',
      auditTrail: {
        note: 'MOCK: reemplazar por el audit trail del proveedor real.',
        events: [
          { type: 'envelope.sent', at: entry.envelope.sentAt },
          { type: 'envelope.signed', at: signedAt },
        ],
      },
    };
  }

  parseWebhook(rawBody: string, signature: string | undefined, secret: string): EsignWebhookEvent {
    // MOCK: reemplazar por proveedor real — la verificación HMAC de abajo imita
    // la que hacen los proveedores reales, y debe conservarse.
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = signature ?? '';
    const ok =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) throw new Error('Firma del webhook no válida.');

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    return {
      envelopeId: String(payload.envelope_id ?? ''),
      referenceId: payload.reference_id ? String(payload.reference_id) : undefined,
      type: (payload.type as EsignWebhookEvent['type']) ?? 'signed',
      occurredAt: String(payload.occurred_at ?? new Date().toISOString()),
      signerName: payload.signer_name ? String(payload.signer_name) : undefined,
      signerEmail: payload.signer_email ? String(payload.signer_email) : undefined,
      raw: payload,
    };
  }
}
