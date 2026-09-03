import type { EmailMessage, EmailProvider, EmailSendResult } from './types.js';

/**
 * MOCK: reemplazar por proveedor real.
 * No envía nada; deja constancia en el log del proceso y en `email_log`.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';

  constructor(private readonly log: (msg: string, data: unknown) => void) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.log('[MOCK EMAIL] no enviado — proveedor simulado', {
      to: message.to,
      template: message.template,
      subject: message.subject,
    });
    return { provider: this.name, providerRef: null, status: 'skipped' };
  }
}

/** Resend. Implementado con fetch para no arrastrar otro SDK. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage, html: string, text: string): Promise<EmailSendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html,
          text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });

      if (!response.ok) {
        return {
          provider: this.name,
          providerRef: null,
          status: 'failed',
          error: `HTTP ${response.status}: ${await response.text()}`,
        };
      }

      const body = (await response.json()) as { id?: string };
      return { provider: this.name, providerRef: body.id ?? null, status: 'sent' };
    } catch (err) {
      return {
        provider: this.name,
        providerRef: null,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
