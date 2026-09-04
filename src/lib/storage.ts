import type { FastifyInstance } from 'fastify';

/**
 * Descarga un objeto de un bucket privado usando la service role.
 * Nunca se expone directamente: el binario se procesa (marca de agua) o se
 * re-sube antes de entregarse mediante URL firmada.
 */
export async function downloadObject(
  app: FastifyInstance,
  bucket: string,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await app.supabase.storage.from(bucket).download(path);
  if (error || !data) {
    app.log.warn({ bucket, path, err: error }, 'No se pudo descargar el objeto');
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

export async function uploadObject(
  app: FastifyInstance,
  bucket: string,
  path: string,
  body: Uint8Array,
  contentType = 'application/pdf',
  upsert = true,
): Promise<boolean> {
  const { error } = await app.supabase.storage.from(bucket).upload(path, body, {
    contentType,
    upsert,
  });
  if (error) {
    app.log.error({ bucket, path, err: error }, 'No se pudo subir el objeto');
    return false;
  }
  return true;
}

/**
 * URL firmada de vida corta. El TTL por defecto (5 minutos) es el que exige la
 * política del Deal Room: suficiente para abrir el visor, insuficiente para
 * compartir el enlace.
 */
export async function createSignedUrl(
  app: FastifyInstance,
  bucket: string,
  path: string,
  ttlSeconds: number,
  downloadName?: string,
): Promise<string | null> {
  const { data, error } = await app.supabase.storage
    .from(bucket)
    .createSignedUrl(path, ttlSeconds, downloadName ? { download: downloadName } : undefined);

  if (error || !data) {
    app.log.error({ bucket, path, err: error }, 'No se pudo firmar la URL');
    return null;
  }
  return data.signedUrl;
}

export async function removeObject(
  app: FastifyInstance,
  bucket: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await app.supabase.storage.from(bucket).remove(paths);
  if (error) app.log.warn({ bucket, paths, err: error }, 'No se pudieron borrar objetos');
}
