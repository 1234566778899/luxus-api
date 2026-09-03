import type { AppConfig } from '../../config.js';
import { MockScreeningProvider } from './mock.js';
import type { ScreeningProvider } from './types.js';

export * from './types.js';

export function createScreeningProvider(config: AppConfig): ScreeningProvider {
  switch (config.SCREENING_PROVIDER) {
    case 'acuant':
    case 'dowjones':
      // MOCK: reemplazar por proveedor real.
      throw new Error(
        `[luxus:screening] El proveedor ${config.SCREENING_PROVIDER} aún no está implementado. ` +
          'Implemente ScreeningProvider en apps/api/src/services/screening/ y regístrelo aquí.',
      );
    case 'mock':
    default:
      return new MockScreeningProvider();
  }
}
