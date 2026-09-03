import type { AppConfig } from '../../config.js';
import { MockKycProvider } from './mock.js';
import type { KycProvider } from './types.js';

export * from './types.js';

export function createKycProvider(config: AppConfig): KycProvider {
  switch (config.KYC_PROVIDER) {
    case 'reniec_partner':
      // MOCK: reemplazar por proveedor real.
      // Aquí se instanciaría el cliente del socio con acceso a RENIEC.
      // Mientras no exista contrato, se degrada al mock de forma explícita
      // para no simular una verificación que no ocurrió.
      throw new Error(
        '[luxus:kyc] El proveedor reniec_partner aún no está implementado. ' +
          'Implemente KycProvider en apps/api/src/services/kyc/ y regístrelo aquí.',
      );
    case 'mock':
    default:
      return new MockKycProvider();
  }
}
