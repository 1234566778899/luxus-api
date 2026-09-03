import type {
  AssetMediaRow, AssetPrivateDetailsRow, AssetRow, AssetVerificationItemRow,
  AuditLogRow, BrokerRow, DealRow, DocumentFolder, DocumentPermissionRow,
  DocumentRow, DocumentVersionRow, NdaRow, OfferRow, ProfileRow,
  QaMessageRow, QaThreadRow,
} from './database.types.js';

/** Modelo de la ficha pública (Nivel I). */
export interface PublicAsset extends AssetRow {
  media: AssetMediaRow[];
  broker?: Pick<BrokerRow, 'id' | 'slug' | 'company_name' | 'logo_path' | 'is_verified'> | null;
}

/** Ficha con datos reservados; `private_details` llega null si no hay derecho. */
export interface AssetDetail extends PublicAsset {
  private_details: AssetPrivateDetailsRow | null;
  verification_items?: AssetVerificationItemRow[];
  is_watchlisted?: boolean;
  viewer_level: 1 | 2 | 3;
}

export interface DocumentNode {
  document: DocumentRow;
  currentVersion: DocumentVersionRow | null;
  versions: DocumentVersionRow[];
  permission: DocumentPermissionRow | null;
  /** Calculado en la API: KYC + NDA + permiso vigente. */
  canView: boolean;
  canDownload: boolean;
  expiresAt: string | null;
}

export interface FolderNode {
  folder: DocumentFolder;
  label: string;
  description: string;
  documents: DocumentNode[];
  accessibleCount: number;
  totalCount: number;
}

export interface DealParticipant {
  profile: Pick<ProfileRow, 'id' | 'full_name' | 'email' | 'role' | 'kyc_status'>;
  side: 'buyer' | 'seller' | 'broker';
}

export interface DealDetail {
  deal: DealRow;
  asset: PublicAsset;
  buyer: DealParticipant['profile'];
  seller: DealParticipant['profile'];
  nda: NdaRow | null;
  tree: FolderNode[];
  threads: (QaThreadRow & { messages?: QaMessageRow[] })[];
  offers: OfferRow[];
  auditPreview?: AuditLogRow[];
  /** El comprador nunca recibe esta lista; solo el vendedor y el admin. */
  permissions?: DocumentPermissionRow[];
}

export interface SignedDocumentUrl {
  url: string;
  expiresIn: number;
  expiresAt: string;
  watermarked: boolean;
  fileName: string;
  version: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface AdminMetrics {
  listedGmvUsd: number;
  publishedAssets: number;
  pendingReviewAssets: number;
  verifiedUsers: number;
  totalUsers: number;
  pendingAccessRequests: number;
  pendingKycCases: number;
  dealsByStage: { stage: string; count: number }[];
  membershipRevenueCents: number;
  brokerRevenueCents: number;
  listingFeeRevenueCents: number;
}

export interface SellerAssetStats {
  asset_id: string;
  title: string;
  slug: string;
  status: string;
  views30d: number;
  viewsTotal: number;
  enquiries: number;
  openDeals: number;
}

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};
