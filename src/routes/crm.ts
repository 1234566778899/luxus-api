import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { leadNoteSchema, leadSchema } from '@luxus/shared';
import { badRequest, notFound } from '../plugins/errors.js';

/**
 * CRM ligero interno.
 *
 *  · seller_pipeline — captación de activos off-market
 *  · buyer_enquiry   — consultas «Enquire Privately», asignables al equipo
 */
export default async function crmRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const staffOnly = { preHandler: app.requireRole('admin') };

  r.get(
    '/crm/leads',
    {
      ...staffOnly,
      schema: {
        querystring: z.object({
          kind: z.enum(['seller_pipeline', 'buyer_enquiry']).optional(),
          stage: z.string().optional(),
          assigned_to: z.string().uuid().optional(),
          q: z.string().trim().max(120).optional(),
        }),
      },
    },
    async (request) => {
      let query = app.supabase
        .from('leads')
        .select('*, assignee:profiles!leads_assigned_to_fkey (id, full_name, email)')
        .order('updated_at', { ascending: false });

      const { kind, stage, assigned_to, q } = request.query;
      if (kind) query = query.eq('kind', kind);
      if (stage) query = query.eq('stage', stage as never);
      if (assigned_to) query = query.eq('assigned_to', assigned_to);
      if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,company.ilike.%${q}%`);

      const { data } = await query;

      // Agrupado por etapa para pintar el pipeline sin recalcular en el cliente.
      const byStage = (data ?? []).reduce<Record<string, number>>((acc, lead) => {
        acc[lead.stage] = (acc[lead.stage] ?? 0) + 1;
        return acc;
      }, {});

      return { leads: data ?? [], byStage };
    },
  );

  r.get(
    '/crm/leads/:id',
    { ...staffOnly, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (request) => {
      const { data: lead } = await app.supabase
        .from('leads')
        .select('*, assignee:profiles!leads_assigned_to_fkey (id, full_name, email)')
        .eq('id', request.params.id)
        .maybeSingle();

      if (!lead) throw notFound('Lead no encontrado.');

      const { data: notes } = await app.supabase
        .from('lead_notes')
        .select('*, author:profiles!lead_notes_author_id_fkey (full_name)')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false });

      return { lead, notes: notes ?? [] };
    },
  );

  r.post(
    '/crm/leads',
    { ...staffOnly, schema: { body: leadSchema } },
    async (request, reply) => {
      const { data, error } = await app.supabase
        .from('leads')
        .insert({ ...request.body, created_by: request.auth!.userId } as never)
        .select('*')
        .single();

      if (error) throw badRequest('lead_failed', error.message);

      await app.audit(request, {
        action: 'lead.created',
        entityType: 'lead',
        entityId: data.id,
        metadata: { kind: request.body.kind },
      });

      return reply.code(201).send({ lead: data });
    },
  );

  r.patch(
    '/crm/leads/:id',
    {
      ...staffOnly,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: leadSchema.partial(),
      },
    },
    async (request) => {
      const { data, error } = await app.supabase
        .from('leads')
        .update(request.body as never)
        .eq('id', request.params.id)
        .select('*')
        .single();

      if (error) throw badRequest('lead_update_failed', error.message);

      // Avisar al nuevo responsable de que tiene un lead asignado.
      if (request.body.assigned_to && request.body.assigned_to !== request.auth!.userId) {
        await app.notify({
          userId: request.body.assigned_to,
          type: 'crm.lead_assigned',
          title: 'Lead asignado',
          body: `Se le asignó «${data.name}».`,
          link: `/admin/crm/${data.id}`,
        });
      }

      await app.audit(request, {
        action: 'lead.updated',
        entityType: 'lead',
        entityId: request.params.id,
        metadata: { stage: request.body.stage, assigned_to: request.body.assigned_to },
      });

      return { lead: data };
    },
  );

  r.post(
    '/crm/notes',
    { ...staffOnly, schema: { body: leadNoteSchema } },
    async (request, reply) => {
      const { data, error } = await app.supabase
        .from('lead_notes')
        .insert({
          lead_id: request.body.lead_id,
          author_id: request.auth!.userId,
          body: request.body.body,
        } as never)
        .select('*')
        .single();

      if (error) throw badRequest('note_failed', error.message);

      await app.supabase
        .from('leads')
        .update({ updated_at: new Date().toISOString() } as never)
        .eq('id', request.body.lead_id);

      return reply.code(201).send({ note: data });
    },
  );

  /** Recordatorios vencidos o próximos, para la portada del equipo. */
  r.get('/crm/reminders', staffOnly, async (request) => {
    const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString();

    const { data } = await app.supabase
      .from('leads')
      .select('id, name, company, stage, kind, next_action, next_action_at, assigned_to')
      .not('next_action_at', 'is', null)
      .lte('next_action_at', horizon)
      .neq('stage', 'lost')
      .order('next_action_at', { ascending: true });

    const now = Date.now();
    const mine = (data ?? []).filter((l) => l.assigned_to === request.auth!.userId);

    return {
      all: data ?? [],
      mine,
      overdue: (data ?? []).filter((l) => new Date(l.next_action_at!).getTime() < now),
    };
  });
}
