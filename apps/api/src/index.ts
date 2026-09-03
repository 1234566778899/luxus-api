import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();

const app = await buildServer(config);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Cerrando el servidor');
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  app.log.fatal({ reason }, 'Promesa rechazada sin manejar');
  process.exit(1);
});

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    `LUXUS API escuchando en http://${config.HOST}:${config.PORT} (${config.NODE_ENV})`,
  );
} catch (err) {
  app.log.fatal({ err }, 'No se pudo iniciar el servidor');
  process.exit(1);
}
