import { createHash } from 'node:crypto';
import type { KycCheckResult, KycDocumentRef, KycProvider, KycSubject } from './types.js';

/**
 * MOCK: reemplazar por proveedor real.
 *
 * Implementación determinista para desarrollo y pruebas. No consulta ninguna
 * fuente externa y NO constituye verificación de identidad. Deriva el veredicto
 * del hash del número de documento para que las pruebas sean reproducibles:
 *
 *   · documento terminado en 0  → manual_review
 *   · documento terminado en 9  → rejected
 *   · resto                     → approved
 */
export class MockKycProvider implements KycProvider {
  readonly name = 'mock';

  private results = new Map<string, KycCheckResult>();

  async verify(subject: KycSubject, documents: KycDocumentRef[]): Promise<KycCheckResult> {
    // MOCK: reemplazar por proveedor real — aquí iría la llamada HTTP al
    // proveedor con los documentos y los datos declarados.
    const lastDigit = subject.documentNumber.trim().slice(-1);
    const providerRef = `mock_kyc_${createHash('sha256')
      .update(`${subject.userId}:${subject.documentNumber}`)
      .digest('hex')
      .slice(0, 12)}`;

    const hasIdentity = documents.some((d) => d.docType.startsWith('identity') || d.docType === 'passport');
    const hasFunds = documents.some((d) => d.docType.startsWith('source_of'));

    let verdict: KycCheckResult['verdict'] = 'approved';
    const reasons: string[] = [];

    if (!hasIdentity) {
      verdict = 'manual_review';
      reasons.push('No se recibió documento de identidad legible.');
    }
    if (!hasFunds) {
      verdict = 'manual_review';
      reasons.push('Falta respaldo del origen de fondos.');
    }
    if (lastDigit === '0') {
      verdict = 'manual_review';
      reasons.push('MOCK: caso derivado a revisión manual.');
    }
    if (lastDigit === '9') {
      verdict = 'rejected';
      reasons.push('MOCK: los datos declarados no coinciden con el documento.');
    }

    const result: KycCheckResult = {
      provider: this.name,
      providerRef,
      verdict,
      riskScore: verdict === 'approved' ? 12 : verdict === 'manual_review' ? 48 : 87,
      reasons,
      documentMatch: verdict !== 'rejected',
      livenessPassed: true,
      raw: {
        note: 'MOCK: reemplazar por proveedor real (verificación RENIEC vía tercero autorizado).',
        subject: { userId: subject.userId, documentType: subject.documentType },
        documentsReceived: documents.length,
        evaluatedAt: new Date().toISOString(),
      },
    };

    this.results.set(providerRef, result);
    return result;
  }

  async fetchStatus(providerRef: string): Promise<KycCheckResult | null> {
    return this.results.get(providerRef) ?? null;
  }
}
