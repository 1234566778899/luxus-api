import type { AppConfig } from '../../config.js';
import { MockEsignProvider } from './mock.js';
import type { EsignProvider } from './types.js';

export * from './types.js';

export function createEsignProvider(config: AppConfig): EsignProvider {
  switch (config.ESIGN_PROVIDER) {
    case 'llama_firma':
    case 'docusign':
      // MOCK: reemplazar por proveedor real.
      throw new Error(
        `[luxus:esign] El proveedor ${config.ESIGN_PROVIDER} aún no está implementado. ` +
          'Implemente EsignProvider en src/services/esign/ y regístrelo aquí.',
      );
    case 'mock':
    default:
      return new MockEsignProvider();
  }
}
