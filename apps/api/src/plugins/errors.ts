import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const forbidden = (message: string, code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Recurso no encontrado.', code = 'not_found') =>
  new HttpError(404, code, message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export default fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Los datos enviados no son válidos.',
          details: error.validation.map((issue) => ({
            path: issue.instancePath,
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Los datos enviados no son válidos.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }

    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({
        error: {
          code: fastifyError.code ?? 'request_error',
          message: fastifyError.message ?? 'Petición no válida.',
        },
      });
    }

    request.log.error({ err: error }, 'Error no controlado');
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Se produjo un error interno. El incidente quedó registrado.',
      },
    });
  });

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Ruta no encontrada.' } }),
  );
});
