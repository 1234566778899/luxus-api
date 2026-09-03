import { notFound } from '../plugins/errors.js';

/**
 * `.single()` de supabase-js devuelve `T | null` aunque la fila deba existir.
 * Este ayudante convierte el caso imposible en un 404 explícito en lugar de
 * salpicar el código de aserciones `!`.
 */
export function requireRow<T>(
  result: { data: T },
  message = 'Registro no encontrado.',
): NonNullable<T> {
  if (result.data === null || result.data === undefined) throw notFound(message);
  return result.data as NonNullable<T>;
}

/**
 * Los tipos de `database.types.ts` están escritos a mano y no modelan las
 * relaciones entre tablas, así que PostgREST no puede inferir el tipo de un
 * SELECT con embebidos. Este ayudante marca esos puntos de forma explícita.
 *
 * Al regenerar los tipos con `npm run db:types` las relaciones sí quedan
 * modeladas y estas llamadas pueden retirarse.
 */
export function embedded<T>(value: unknown): T {
  return value as T;
}
