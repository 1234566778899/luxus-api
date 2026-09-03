import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createThreadSchema, isDealRoomOpen, postMessageSchema } from '@luxus/shared';
import { badRequest, conflict, forbidden, notFound } from '../plugins/errors.js';
import { loadDealContext } from '../lib/guards.js';

export default async function qaRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/qa/threads',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: { body: createThreadSchema },
    },
    async (request, reply) => {
      const profile = request.auth!.profile;
      const { deal, asset } = await loadDealContext(app, request.body.deal_id, profile);

      if (!isDealRoomOpen(deal.stage)) {
        throw conflict('deal_closed', 'El Deal Room no está abierto para preguntas.');
      }

      const { data: thread, error } = await app.supabase
        .from('qa_threads')
        .insert({
          deal_id: deal.id,
          subject: request.body.subject,
          document_id: request.body.document_id ?? null,
          folder: request.body.folder ?? null,
          created_by: profile.id,
        } as never)
        .select('*')
        .single();

      if (error || !thread) throw badRequest('thread_failed', 'No se pudo abrir el hilo.');

      await app.supabase.from('qa_messages').insert({
        thread_id: thread.id,
        deal_id: deal.id,
        author_id: profile.id,
        body: request.body.body,
      } as never);

      // Si el deal estaba recién abierto, la primera pregunta lo mueve a Q&A.
      if (deal.stage === 'nda_signed') {
        await app.supabase.from('deals').update({ stage: 'qa' } as never).eq('id', deal.id);
      }

      const counterpartId = profile.id === deal.buyer_id ? deal.seller_id : deal.buyer_id;
      await notifyCounterpart(app, counterpartId, deal.id, asset.title, {
        authorName: profile.full_name ?? profile.email,
        subject: request.body.subject,
        preview: request.body.body.slice(0, 180),
      });

      await app.audit(request, {
        action: 'qa.thread_created',
        entityType: 'qa_thread',
        entityId: thread.id,
        dealId: deal.id,
        assetId: asset.id,
        metadata: { subject: request.body.subject },
      });

      return reply.code(201).send({ thread });
    },
  );

  r.post(
    '/qa/messages',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 90, timeWindow: '1 hour' } },
      schema: { body: postMessageSchema },
    },
    async (request, reply) => {
      const profile = request.auth!.profile;

      const { data: thread } = await app.supabase
        .from('qa_threads')
        .select('*')
        .eq('id', request.body.thread_id)
        .maybeSingle();

      if (!thread) throw notFound('Hilo no encontrado.');

      const { deal, asset } = await loadDealContext(app, thread.deal_id, profile);
      if (!isDealRoomOpen(deal.stage)) {
        throw conflict('deal_closed', 'El Deal Room no está abierto.');
      }

      const { data: message, error } = await app.supabase
        .from('qa_messages')
        .insert({
          thread_id: thread.id,
          deal_id: deal.id,
          author_id: profile.id,
          body: request.body.body,
          attachment_document_id: request.body.attachment_document_id ?? null,
        } as never)
        .select('*')
        .single();

      if (error || !message) throw badRequest('message_failed', 'No se pudo publicar la respuesta.');

      const counterpartId = profile.id === deal.buyer_id ? deal.seller_id : deal.buyer_id;
      await notifyCounterpart(app, counterpartId, deal.id, asset.title, {
        authorName: profile.full_name ?? profile.email,
        subject: thread.subject,
        preview: request.body.body.slice(0, 180),
      });

      await app.audit(request, {
        action: 'qa.message_posted',
        entityType: 'qa_thread',
        entityId: thread.id,
        dealId: deal.id,
      });

      return reply.code(201).send({ message });
    },
  );

  r.post(
    '/qa/threads/:id/resolve',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ resolved: z.boolean().default(true) }),
      },
    },
    async (request) => {
      const profile = request.auth!.profile;

      const { data: thread } = await app.supabase
        .from('qa_threads')
        .select('*')
        .eq('id', request.params.id)
        .maybeSingle();

      if (!thread) throw notFound('Hilo no encontrado.');
      const { side } = await loadDealContext(app, thread.deal_id, profile);
      if (side === 'buyer' && thread.created_by !== profile.id) {
        throw forbidden('Solo quien abrió el hilo o el vendedor puede cerrarlo.');
      }

      await app.supabase
        .from('qa_threads')
        .update({
          is_resolved: request.body.resolved,
          resolved_at: request.body.resolved ? new Date().toISOString() : null,
        } as never)
        .eq('id', thread.id);

      return { ok: true, resolved: request.body.resolved };
    },
  );
}

async function notifyCounterpart(
  app: FastifyInstance,
  userId: string,
  dealId: string,
  assetTitle: string,
  payload: { authorName: string; subject: string; preview: string },
): Promise<void> {
  const { data: user } = await app.supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (user) {
    await app.sendMail({
      to: user.email,
      userId,
      template: 'qa_new_message',
      subject: '',
      data: { ...payload, assetTitle, dealId },
    });
  }

  await app.notify({
    userId,
    type: 'qa.new_message',
    title: 'Nueva actividad en el Deal Room',
    body: `${payload.authorName}: «${payload.subject}»`,
    link: `/deal/${dealId}#qa`,
    dealId,
  });
}
