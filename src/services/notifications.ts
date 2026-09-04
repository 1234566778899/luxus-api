import type { FastifyInstance } from 'fastify';

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  dealId?: string;
  assetId?: string;
  severity?: 'info' | 'success' | 'warning' | 'critical';
}

/**
 * Notificación in-app. La tabla está en la publicación de realtime, así que el
 * centro de notificaciones del cliente la recibe sin polling.
 */
export async function notify(app: FastifyInstance, input: NotificationInput): Promise<void> {
  try {
    const { data: prefs } = await app.supabase
      .from('notification_preferences')
      .select('in_app_enabled')
      .eq('user_id', input.userId)
      .maybeSingle();

    if (prefs && prefs.in_app_enabled === false) return;

    const { error } = await app.supabase.from('notifications').insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      deal_id: input.dealId ?? null,
      asset_id: input.assetId ?? null,
      severity: input.severity ?? 'info',
    } as never);

    if (error) app.log.error({ err: error, input }, 'No se pudo crear la notificación');
  } catch (err) {
    app.log.error({ err, input }, 'Fallo inesperado creando notificación');
  }
}

export async function notifyMany(
  app: FastifyInstance,
  inputs: NotificationInput[],
): Promise<void> {
  await Promise.all(inputs.map((input) => notify(app, input)));
}
