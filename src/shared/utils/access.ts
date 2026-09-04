import type { DealStage, ProfileRow } from '../types/database.types.js';
import { OPEN_DEAL_STAGES } from '../constants/deal.js';

/**
 * Los tres niveles de información de la plataforma.
 *
 *  1 · Público          — categoría, distrito, rango de precio, fotos seleccionadas
 *  2 · Miembro verificado — precio exacto, ubicación real, media privada
 *  3 · Deal Room        — documentación, bajo NDA y permiso vigente
 */
export type InformationLevel = 1 | 2 | 3;

export function levelForProfile(profile: Pick<ProfileRow, 'role' | 'kyc_status' | 'screening_status' | 'is_suspended'> | null): InformationLevel {
  if (!profile || profile.is_suspended) return 1;
  if (profile.role === 'admin') return 3;
  if (profile.kyc_status === 'approved' && profile.screening_status !== 'blocked') return 2;
  return 1;
}

export function isVerifiedMember(
  profile: Pick<ProfileRow, 'kyc_status' | 'screening_status' | 'is_suspended'> | null,
): boolean {
  return Boolean(
    profile &&
      !profile.is_suspended &&
      profile.kyc_status === 'approved' &&
      profile.screening_status !== 'blocked',
  );
}

export function dealRoomIsOpen(stage: DealStage, expiresAt: string | null): boolean {
  if (!OPEN_DEAL_STAGES.includes(stage)) return false;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return false;
  return true;
}

export interface PermissionLike {
  revoked_at: string | null;
  expires_at: string | null;
  level: 'view' | 'download';
}

export function permissionIsValid(
  permission: PermissionLike | null | undefined,
  required: 'view' | 'download' = 'view',
): boolean {
  if (!permission) return false;
  if (permission.revoked_at) return false;
  if (permission.expires_at && new Date(permission.expires_at).getTime() <= Date.now()) return false;
  if (required === 'download' && permission.level !== 'download') return false;
  return true;
}

export function daysUntil(value: string | null): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}
