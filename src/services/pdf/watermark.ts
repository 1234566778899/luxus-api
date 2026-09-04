import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export interface WatermarkOptions {
  /** Correo del usuario que descarga: hace personal cada copia. */
  email: string;
  /** Momento de la entrega, en horario de Lima. */
  timestamp?: Date;
  dealReference?: string;
  documentName?: string;
}

const LIMA_TZ = 'America/Lima';

function formatLima(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: LIMA_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Marca de agua dinámica sobre cada página.
 *
 * Cada copia entregada queda ligada a quien la abrió: si un PDF de un Deal Room
 * aparece fuera de la plataforma, el correo y la marca temporal identifican la
 * sesión de origen. Se combina con el audit log, que registra la misma entrega.
 */
export async function watermarkPdf(
  input: Uint8Array | ArrayBuffer,
  options: WatermarkOptions,
): Promise<Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });

  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const stamp = formatLima(options.timestamp ?? new Date());
  const diagonal = `CONFIDENTIAL — LUXUS PRIVATE DEAL ROOM — ${options.email} — ${stamp}`;

  const footerLeft = options.dealReference
    ? `LUXUS PRIVATE DEAL ROOM · ${options.dealReference}`
    : 'LUXUS PRIVATE DEAL ROOM';
  const footerRight = `${options.email} · ${stamp}`;

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();

    // Diagonal repetida: legible pero sin impedir la lectura del documento.
    const fontSize = Math.max(9, Math.min(14, width / 62));
    const textWidth = helvetica.widthOfTextAtSize(diagonal, fontSize);
    const step = Math.max(150, textWidth * 0.55);

    for (let y = -height; y < height * 2; y += step) {
      page.drawText(diagonal, {
        x: -width * 0.15,
        y,
        size: fontSize,
        font: helvetica,
        color: rgb(0.55, 0.55, 0.6),
        opacity: 0.16,
        rotate: degrees(35),
      });
    }

    // Banda inferior sólida con la trazabilidad legible.
    page.drawRectangle({
      x: 0, y: 0, width, height: 26,
      color: rgb(0.094, 0.094, 0.094), opacity: 0.92,
    });
    page.drawText(footerLeft, {
      x: 18, y: 9, size: 7.5, font: helveticaBold, color: rgb(1, 1, 1), opacity: 0.9,
    });
    const rightWidth = helvetica.widthOfTextAtSize(footerRight, 7.5);
    page.drawText(footerRight, {
      x: Math.max(18, width - rightWidth - 18),
      y: 9, size: 7.5, font: helvetica, color: rgb(1, 1, 1), opacity: 0.85,
    });
  }

  // Metadatos: quien inspeccione el archivo ve de dónde salió.
  pdf.setProducer('LUXUS PERÚ — Private Deal Room');
  pdf.setCreator('LUXUS PERÚ');
  pdf.setSubject(`CONFIDENCIAL · entregado a ${options.email} el ${stamp}`);
  if (options.documentName) pdf.setTitle(options.documentName);

  return pdf.save({ useObjectStreams: true });
}

export function isPdf(mimeType: string | null | undefined): boolean {
  return (mimeType ?? '').toLowerCase().includes('pdf');
}
