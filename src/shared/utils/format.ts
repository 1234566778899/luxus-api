import type { AssetCategory, AssetRow } from '../types/database.types.js';
import { CATEGORY_META } from '../constants/categories.js';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return usd.format(amount);
}

export function formatUsdCompact(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return compactUsd.format(amount).replace('$', 'USD ');
}

export function formatCents(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Rango público de precio. Nunca devuelve el importe exacto: la ficha pública
 * solo conoce price_min / price_max.
 */
export function formatPriceRange(
  asset: Pick<AssetRow, 'price_min' | 'price_max' | 'price_on_request'>,
): string {
  if (asset.price_on_request) return 'Precio a consultar';
  const { price_min: min, price_max: max } = asset;
  if (min === null && max === null) return 'Precio a consultar';
  if (min !== null && max !== null && min !== max) {
    return `${compactUsd.format(min).replace('$', 'USD ')} – ${compactUsd.format(max).replace('$', '')}`;
  }
  return `Desde ${compactUsd.format(min ?? max ?? 0).replace('$', 'USD ')}`;
}

/** «Miraflores, Lima» — nunca la dirección. */
export function formatApproximateLocation(
  asset: Pick<AssetRow, 'district' | 'province' | 'region'>,
): string {
  return [asset.district, asset.region].filter(Boolean).join(', ') || 'Perú';
}

export function categoryLabel(category: AssetCategory): string {
  return CATEGORY_META[category].label;
}

const dateFmt = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit', month: 'short', year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** "LX-000123" — el correlativo que ve el reclamante y el que usa el equipo. */
export function formatComplaintReference(entryNumber: number | string): string {
  return `LX-${String(entryNumber).padStart(6, '0')}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateFmt.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateTimeFmt.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat('es-PE', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000_000], ['month', 2_592_000_000], ['day', 86_400_000],
    ['hour', 3_600_000], ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return 'ahora';
}

export function formatSpecValue(value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.join(' · ');
  if (typeof value === 'number') {
    // Un año (1900-2100) nunca lleva separador de miles: "2021", no "2,021".
    const isYearLike = Number.isInteger(value) && value >= 1000 && value <= 2100;
    const formatted = new Intl.NumberFormat('es-PE', {
      maximumFractionDigits: 2,
      useGrouping: !isYearLike,
    }).format(value);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return unit ? `${String(value)} ${unit}` : String(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '··';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
