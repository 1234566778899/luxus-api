import type { FastifyInstance } from 'fastify';
import type { AssetRow, DealRow, DocumentRow, ProfileRow } from '@luxus/shared';
import { forbidden, notFound } from '../plugins/errors.js';

export interface DealContext {
  deal: DealRow;
  asset: AssetRow;
  side: 'buyer' | 'seller' | 'broker' | 'admin';
}

/**
 * Carga un deal y verifica que quien pregunta es parte legítima.
 *
 * Las rutas del Deal Room usan la service role para poder cruzar tablas sin
 * pelearse con RLS, así que la comprobación de pertenencia tiene que ser
 * explícita aquí. Es el punto único donde se decide "esta persona pertenece a
 * este deal".
 */
export async function loadDealContext(
  app: FastifyInstance,
  dealId: string,
  profile: ProfileRow,
): Promise<DealContext> {
  const { data: deal } = await app.supabase
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .maybeSingle();

  if (!deal) throw notFound('El Deal Room no existe o fue retirado.');

  const { data: asset } = await app.supabase
    .from('assets')
    .select('*')
    .eq('id', deal.asset_id)
    .maybeSingle();

  if (!asset) throw notFound('El activo asociado ya no está disponible.');

  if (profile.role === 'admin') return { deal, asset, side: 'admin' };
  if (deal.buyer_id === profile.id) return { deal, asset, side: 'buyer' };
  if (deal.seller_id === profile.id) return { deal, asset, side: 'seller' };

  if (deal.broker_id) {
    const { data: broker } = await app.supabase
      .from('brokers')
      .select('user_id')
      .eq('id', deal.broker_id)
      .maybeSingle();
    if (broker?.user_id === profile.id) return { deal, asset, side: 'broker' };
  }

  throw forbidden('No forma parte de este Deal Room.');
}

/** El vendedor y su bróker gobiernan el activo; el admin también. */
export async function assertControlsAsset(
  app: FastifyInstance,
  assetId: string,
  profile: ProfileRow,
): Promise<AssetRow> {
  const { data: asset } = await app.supabase
    .from('assets')
    .select('*')
    .eq('id', assetId)
    .maybeSingle();

  if (!asset) throw notFound('Activo no encontrado.');
  if (profile.role === 'admin') return asset;
  if (asset.owner_id === profile.id) return asset;

  if (asset.broker_id) {
    const { data: broker } = await app.supabase
      .from('brokers')
      .select('user_id')
      .eq('id', asset.broker_id)
      .maybeSingle();
    if (broker?.user_id === profile.id) return asset;
  }

  throw forbidden('No administra este activo.');
}

export async function loadDocument(
  app: FastifyInstance,
  documentId: string,
): Promise<DocumentRow> {
  const { data } = await app.supabase
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) throw notFound('Documento no encontrado.');
  return data;
}

/** Nivel II. El admin siempre lo cumple. */
export function assertVerifiedMember(profile: ProfileRow): void {
  if (profile.role === 'admin') return;
  if (profile.kyc_status !== 'approved') {
    throw forbidden('Debe completar la verificación KYC.', 'kyc_required');
  }
  if (profile.screening_status === 'blocked') {
    throw forbidden('Su cuenta está bloqueada por cumplimiento.', 'screening_blocked');
  }
}
