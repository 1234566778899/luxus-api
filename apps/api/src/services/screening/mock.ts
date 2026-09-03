import { createHash } from 'node:crypto';
import type {
  ScreeningMatch, ScreeningProvider, ScreeningResult, ScreeningSubject,
} from './types.js';

const LISTS = ['PEP', 'OFAC-SDN', 'UN-CONSOLIDATED', 'EU-SANCTIONS', 'UK-HMT', 'ADVERSE-MEDIA'];

/**
 * MOCK: reemplazar por proveedor real.
 *
 * No consulta ninguna lista. Genera un resultado estable a partir del nombre
 * para poder ejercitar los tres caminos de la interfaz de revisión.
 */
export class MockScreeningProvider implements ScreeningProvider {
  readonly name = 'mock';

  async screen(subject: ScreeningSubject): Promise<ScreeningResult> {
    // MOCK: reemplazar por proveedor real — aquí iría la consulta al agregador
    // de listas (Dow Jones, Refinitiv, ComplyAdvantage, Acuant…).
    const digest = createHash('sha256').update(subject.fullName.toLowerCase()).digest();
    const bucket = digest[0]! % 20;

    const matches: ScreeningMatch[] = [];
    let verdict: ScreeningResult['verdict'] = 'clear';

    if (bucket === 0) {
      verdict = 'blocked';
      matches.push({
        list: 'OFAC-SDN',
        matchedName: subject.fullName.toUpperCase(),
        score: 0.94,
        category: 'sanction',
        details: 'MOCK: coincidencia simulada en lista de sanciones.',
      });
    } else if (bucket < 4) {
      verdict = 'flagged';
      matches.push({
        list: 'PEP',
        matchedName: subject.fullName.toUpperCase(),
        score: 0.71,
        category: 'pep',
        details: 'MOCK: posible persona expuesta políticamente. Requiere revisión manual.',
      });
    }

    return {
      provider: this.name,
      providerRef: `mock_scr_${digest.toString('hex').slice(0, 12)}`,
      verdict,
      listsChecked: LISTS,
      matches,
      riskScore: verdict === 'clear' ? 8 : verdict === 'flagged' ? 55 : 92,
      raw: {
        note: 'MOCK: reemplazar por proveedor real de screening PEP/sanciones/adverse media.',
        evaluatedAt: new Date().toISOString(),
      },
    };
  }
}
