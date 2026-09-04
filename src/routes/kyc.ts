import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { kycDecisionSchema, kycSubmitSchema } from '@luxus/shared';
import { badRequest, notFound } from '../plugins/errors.js';

/**
 * Onboarding KYC + screening.
 *
 * La decisión nunca la toma el cliente: el wizard envía datos, la API llama al
 * proveedor (mock por defecto) y el resultado se materializa en el perfil, que
 * es lo que RLS consulta para conceder el Nivel II.
 */
export default async function kycRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── Estado del caso propio ──────────────────────────────────────────────
  r.get('/kyc/me', { preHandler: app.requireAuth }, async (request) => {
    const userId = request.auth!.userId;

    const { data: kycCase } = await app.supabase
      .from('kyc_cases')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: screening } = await app.supabase
      .from('screening_checks')
      .select('id, status, match_count, lists_checked, risk_score, ran_at')
      .eq('user_id', userId)
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const documents = kycCase
      ? (
          await app.supabase
            .from('kyc_documents')
            .select('id, doc_type, file_name, uploaded_at')
            .eq('case_id', kycCase.id)
        ).data ?? []
      : [];

    return {
      profile: {
        kyc_status: request.auth!.profile.kyc_status,
        screening_status: request.auth!.profile.screening_status,
        access_level: request.auth!.profile.access_level,
      },
      case: kycCase,
      documents,
      screening,
    };
  });

  // ── URL firmada para subir un documento al bucket privado ───────────────
  r.post(
    '/kyc/upload-url',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
      schema: {
        body: z.object({
          doc_type: z.enum([
            'identity_front', 'identity_back', 'passport', 'proof_of_address',
            'source_of_funds', 'source_of_wealth', 'corporate_deed', 'ubo_declaration', 'other',
          ]),
          file_name: z.string().trim().min(1).max(255),
          mime_type: z.string().trim().max(120),
        }),
      },
    },
    async (request) => {
      const userId = request.auth!.userId;
      const ext = request.body.file_name.split('.').pop()?.toLowerCase().slice(0, 8) ?? 'bin';
      // Ruta bajo la carpeta del usuario: la política de Storage exige que el
      // primer segmento sea su propio id.
      const path = `${userId}/${request.body.doc_type}-${Date.now()}.${ext}`;

      const { data, error } = await app.supabase.storage
        .from('kyc-documents')
        .createSignedUploadUrl(path);

      if (error || !data) {
        throw badRequest('upload_url_failed', 'No se pudo preparar la carga del documento.');
      }

      return { path, token: data.token, signedUrl: data.signedUrl, bucket: 'kyc-documents' };
    },
  );

  // ── Envío del expediente ────────────────────────────────────────────────
  r.post(
    '/kyc/submit',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 6, timeWindow: '1 hour' } },
      schema: { body: kycSubmitSchema },
    },
    async (request) => {
      const profile = request.auth!.profile;
      const body = request.body;

      if (profile.kyc_status === 'approved') {
        throw badRequest('already_approved', 'Su verificación ya está aprobada.');
      }

      // 1 · Persistir el caso declarado.
      const casePayload = {
        user_id: profile.id,
        status: 'submitted' as const,
        provider: app.kyc.name,
        legal_name: body.identity.legal_name,
        document_type: body.identity.document_type,
        document_number: body.identity.document_number,
        nationality: body.identity.nationality,
        birth_date: body.identity.birth_date,
        tax_residence: body.identity.tax_residence,
        occupation: body.identity.occupation,
        is_pep: body.pep.is_pep,
        pep_details: body.pep.pep_details ?? null,
        source_of_funds: body.funds.source_of_funds,
        source_of_wealth: body.funds.source_of_wealth,
        estimated_net_worth_band: body.funds.estimated_net_worth_band,
        funds_declaration: body.funds.funds_declaration,
        submitted_at: new Date().toISOString(),
      };

      const { data: kycCase, error: caseError } = body.case_id
        ? await app.supabase
            .from('kyc_cases')
            .update(casePayload as never)
            .eq('id', body.case_id)
            .eq('user_id', profile.id)
            .select('*')
            .single()
        : await app.supabase
            .from('kyc_cases')
            .insert(casePayload as never)
            .select('*')
            .single();

      if (caseError || !kycCase) {
        request.log.error({ err: caseError }, 'No se pudo guardar el caso KYC');
        throw badRequest('kyc_save_failed', 'No pudimos guardar su expediente.');
      }

      // 2 · Registrar los documentos ya subidos.
      await app.supabase.from('kyc_documents').insert(
        body.documents.map((doc) => ({
          case_id: kycCase.id,
          user_id: profile.id,
          doc_type: doc.doc_type,
          bucket: 'kyc-documents',
          storage_path: doc.storage_path,
          file_name: doc.file_name ?? null,
          mime_type: doc.mime_type ?? null,
          size_bytes: doc.size_bytes ?? null,
        })) as never,
      );

      await app.supabase
        .from('profiles')
        .update({ kyc_status: 'submitted' } as never)
        .eq('id', profile.id);

      // 3 · Verificación con el proveedor.
      const verdict = await app.kyc.verify(
        {
          userId: profile.id,
          legalName: body.identity.legal_name,
          documentType: body.identity.document_type,
          documentNumber: body.identity.document_number,
          nationality: body.identity.nationality,
          birthDate: body.identity.birth_date,
          email: profile.email,
          phone: profile.phone,
        },
        body.documents.map((d) => ({
          docType: d.doc_type,
          bucket: 'kyc-documents',
          storagePath: d.storage_path,
          mimeType: d.mime_type ?? null,
        })),
      );

      // 4 · Aprobación automática solo si el proveedor la respalda y el
      //     screening no levanta banderas. Todo lo demás va a revisión manual.
      let finalStatus: 'approved' | 'rejected' | 'in_review' =
        verdict.verdict === 'approved' ? 'approved'
        : verdict.verdict === 'rejected' ? 'rejected'
        : 'in_review';

      let screeningStatus: 'clear' | 'flagged' | 'blocked' | 'not_run' = 'not_run';

      if (finalStatus === 'approved') {
        const screening = await app.screening.screen({
          userId: profile.id,
          fullName: body.identity.legal_name,
          documentNumber: body.identity.document_number,
          birthDate: body.identity.birth_date,
          nationality: body.identity.nationality,
          country: profile.country,
        });

        await app.supabase.from('screening_checks').insert({
          user_id: profile.id,
          kyc_case_id: kycCase.id,
          provider: screening.provider,
          provider_ref: screening.providerRef,
          status: screening.verdict,
          lists_checked: screening.listsChecked,
          match_count: screening.matches.length,
          matches: screening.matches,
          risk_score: screening.riskScore,
        } as never);

        screeningStatus = screening.verdict;
        if (screening.verdict === 'blocked') finalStatus = 'rejected';
        if (screening.verdict === 'flagged') finalStatus = 'in_review';
      }

      await app.supabase
        .from('kyc_cases')
        .update({
          status: finalStatus,
          provider_ref: verdict.providerRef,
          provider_payload: verdict.raw,
          requires_manual_review: finalStatus === 'in_review',
          rejection_reason: finalStatus === 'rejected' ? verdict.reasons.join(' ') : null,
          decided_at: finalStatus === 'in_review' ? null : new Date().toISOString(),
          expires_at:
            finalStatus === 'approved'
              ? new Date(Date.now() + 365 * 86_400_000).toISOString()
              : null,
        } as never)
        .eq('id', kycCase.id);

      await app.supabase
        .from('profiles')
        .update({
          kyc_status: finalStatus,
          ...(screeningStatus !== 'not_run' ? { screening_status: screeningStatus } : {}),
        } as never)
        .eq('id', profile.id);

      await app.audit(request, {
        action: `kyc.${finalStatus}`,
        entityType: 'kyc_case',
        entityId: kycCase.id,
        metadata: {
          provider: verdict.provider,
          riskScore: verdict.riskScore,
          screening: screeningStatus,
        },
      });

      const templates = {
        approved: 'kyc_approved',
        rejected: 'kyc_rejected',
        in_review: 'kyc_manual_review',
      } as const;

      await app.sendMail({
        to: profile.email,
        userId: profile.id,
        template: templates[finalStatus],
        subject: '',
        data: { name: profile.full_name ?? '', reason: verdict.reasons.join(' ') },
      });

      await app.notify({
        userId: profile.id,
        type: `kyc.${finalStatus}`,
        title:
          finalStatus === 'approved' ? 'Verificación aprobada'
          : finalStatus === 'rejected' ? 'Verificación rechazada'
          : 'Verificación en revisión',
        body:
          finalStatus === 'approved'
            ? 'Ya tiene acceso a la información de Nivel II.'
            : finalStatus === 'rejected'
              ? verdict.reasons.join(' ')
              : 'Nuestro equipo de cumplimiento revisará su expediente.',
        link: '/dashboard',
        severity: finalStatus === 'approved' ? 'success' : finalStatus === 'rejected' ? 'warning' : 'info',
      });

      return { status: finalStatus, case_id: kycCase.id, screening: screeningStatus };
    },
  );

  // ── Revisión manual (Admin) ─────────────────────────────────────────────
  r.get(
    '/admin/kyc/queue',
    { preHandler: app.requireRole('admin') },
    async () => {
      const { data } = await app.supabase
        .from('kyc_cases')
        .select('*, profiles!kyc_cases_user_id_fkey(id, full_name, email, role)')
        .in('status', ['submitted', 'in_review'])
        .order('submitted_at', { ascending: true });
      return { cases: data ?? [] };
    },
  );

  r.post(
    '/admin/kyc/decision',
    {
      preHandler: app.requireRole('admin'),
      schema: { body: kycDecisionSchema },
    },
    async (request) => {
      const { case_id, decision, reviewer_notes, rejection_reason } = request.body;

      const { data: kycCase } = await app.supabase
        .from('kyc_cases')
        .select('*')
        .eq('id', case_id)
        .maybeSingle();

      if (!kycCase) throw notFound('Caso KYC no encontrado.');

      await app.supabase
        .from('kyc_cases')
        .update({
          status: decision,
          reviewer_id: request.auth!.userId,
          reviewer_notes: reviewer_notes ?? null,
          rejection_reason: rejection_reason ?? null,
          requires_manual_review: false,
          decided_at: new Date().toISOString(),
          expires_at:
            decision === 'approved'
              ? new Date(Date.now() + 365 * 86_400_000).toISOString()
              : null,
        } as never)
        .eq('id', case_id);

      let screeningStatus: string | null = null;

      if (decision === 'approved') {
        const screening = await app.screening.screen({
          userId: kycCase.user_id,
          fullName: kycCase.legal_name ?? '',
          documentNumber: kycCase.document_number,
          birthDate: kycCase.birth_date,
          nationality: kycCase.nationality,
        });

        await app.supabase.from('screening_checks').insert({
          user_id: kycCase.user_id,
          kyc_case_id: kycCase.id,
          provider: screening.provider,
          provider_ref: screening.providerRef,
          status: screening.verdict,
          lists_checked: screening.listsChecked,
          match_count: screening.matches.length,
          matches: screening.matches,
          risk_score: screening.riskScore,
          reviewer_id: request.auth!.userId,
          reviewed_at: new Date().toISOString(),
        } as never);

        screeningStatus = screening.verdict;
      }

      await app.supabase
        .from('profiles')
        .update({
          kyc_status: decision,
          ...(screeningStatus ? { screening_status: screeningStatus } : {}),
        } as never)
        .eq('id', kycCase.user_id);

      const { data: subject } = await app.supabase
        .from('profiles')
        .select('email, full_name')
        .eq('id', kycCase.user_id)
        .maybeSingle();

      if (subject) {
        await app.sendMail({
          to: subject.email,
          userId: kycCase.user_id,
          template: decision === 'approved' ? 'kyc_approved' : 'kyc_rejected',
          subject: '',
          data: { name: subject.full_name ?? '', reason: rejection_reason ?? '' },
        });
      }

      await app.notify({
        userId: kycCase.user_id,
        type: `kyc.${decision}`,
        title: decision === 'approved' ? 'Verificación aprobada' : 'Verificación rechazada',
        body: decision === 'approved' ? 'Ya tiene acceso Nivel II.' : (rejection_reason ?? ''),
        link: '/dashboard',
        severity: decision === 'approved' ? 'success' : 'warning',
      });

      await app.audit(request, {
        action: `kyc.${decision}`,
        entityType: 'kyc_case',
        entityId: case_id,
        metadata: { manual: true, screening: screeningStatus },
      });

      return { ok: true, status: decision, screening: screeningStatus };
    },
  );

  // ── Re-ejecutar screening sobre un usuario ya verificado ────────────────
  r.post(
    '/admin/screening/run',
    {
      preHandler: app.requireRole('admin'),
      schema: { body: z.object({ user_id: z.string().uuid() }) },
    },
    async (request) => {
      const { data: subject } = await app.supabase
        .from('profiles')
        .select('id, full_name, country')
        .eq('id', request.body.user_id)
        .maybeSingle();

      if (!subject) throw notFound('Usuario no encontrado.');

      const screening = await app.screening.screen({
        userId: subject.id,
        fullName: subject.full_name ?? '',
        country: subject.country,
      });

      await app.supabase.from('screening_checks').insert({
        user_id: subject.id,
        provider: screening.provider,
        provider_ref: screening.providerRef,
        status: screening.verdict,
        lists_checked: screening.listsChecked,
        match_count: screening.matches.length,
        matches: screening.matches,
        risk_score: screening.riskScore,
        reviewer_id: request.auth!.userId,
      } as never);

      await app.supabase
        .from('profiles')
        .update({ screening_status: screening.verdict } as never)
        .eq('id', subject.id);

      await app.audit(request, {
        action: 'screening.run',
        entityType: 'profile',
        entityId: subject.id,
        metadata: { verdict: screening.verdict, matches: screening.matches.length },
      });

      return { verdict: screening.verdict, matches: screening.matches };
    },
  );
}
