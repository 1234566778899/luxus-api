import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

const NAVY = rgb(0.094, 0.094, 0.094);
const GOLD = rgb(0.059, 0.431, 0.431);
const GREY = rgb(0.35, 0.35, 0.35);
const MARGIN = 64;

interface Writer {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
}

async function startDocument(title: string, subtitle: string): Promise<Writer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);

  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: NAVY });
  page.drawText('LUXUS PERÚ', {
    x: MARGIN, y: height - 48, size: 15, font: bold, color: rgb(1, 1, 1),
  });
  page.drawText('EXCEPTIONAL ASSETS · PRIVATE TRANSACTIONS', {
    x: MARGIN, y: height - 66, size: 7, font: regular, color: GOLD,
  });

  const writer: Writer = { pdf, page, y: height - 150, regular, bold, serif };
  heading(writer, title, 18);
  paragraph(writer, subtitle, { size: 9.5, color: GREY });
  writer.y -= 10;
  return writer;
}

function ensureSpace(w: Writer, needed: number): void {
  if (w.y - needed > MARGIN + 40) return;
  w.page = w.pdf.addPage([595.28, 841.89]);
  w.y = w.page.getSize().height - MARGIN;
}

function heading(w: Writer, text: string, size = 12): void {
  ensureSpace(w, size + 22);
  w.page.drawText(text, { x: MARGIN, y: w.y, size, font: w.bold, color: NAVY });
  w.y -= size + 10;
}

function paragraph(
  w: Writer,
  text: string,
  opts: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont } = {},
): void {
  const size = opts.size ?? 10;
  const font = opts.font ?? w.serif;
  const color = opts.color ?? rgb(0.1, 0.1, 0.1);
  const maxWidth = 595.28 - MARGIN * 2;
  const lineHeight = size * 1.55;

  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      w.y -= lineHeight * 0.6;
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
        ensureSpace(w, lineHeight);
        w.page.drawText(line, { x: MARGIN, y: w.y, size, font, color });
        w.y -= lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      ensureSpace(w, lineHeight);
      w.page.drawText(line, { x: MARGIN, y: w.y, size, font, color });
      w.y -= lineHeight;
    }
  }
  w.y -= 6;
}

function keyValue(w: Writer, label: string, value: string): void {
  ensureSpace(w, 18);
  w.page.drawText(label.toUpperCase(), {
    x: MARGIN, y: w.y, size: 7.5, font: w.bold, color: GREY,
  });
  w.page.drawText(value, {
    x: MARGIN + 150, y: w.y, size: 10, font: w.serif, color: rgb(0.1, 0.1, 0.1),
  });
  w.y -= 18;
}

function signatureBlocks(w: Writer, parties: { role: string; name: string }[]): void {
  ensureSpace(w, 120);
  w.y -= 24;
  const columnWidth = (595.28 - MARGIN * 2 - 40) / 2;
  const baseY = w.y;
  parties.slice(0, 2).forEach((party, i) => {
    const x = MARGIN + i * (columnWidth + 40);
    w.page.drawLine({
      start: { x, y: baseY }, end: { x: x + columnWidth, y: baseY },
      thickness: 0.75, color: GREY,
    });
    w.page.drawText(party.name, { x, y: baseY - 14, size: 9.5, font: w.bold, color: NAVY });
    w.page.drawText(party.role, { x, y: baseY - 27, size: 7.5, font: w.regular, color: GREY });
  });
  w.y = baseY - 50;
}

function disclaimer(w: Writer, text: string): void {
  ensureSpace(w, 60);
  w.y -= 10;
  w.page.drawRectangle({
    x: MARGIN - 10, y: w.y - 34, width: 595.28 - MARGIN * 2 + 20, height: 44,
    color: rgb(0.96, 0.95, 0.93),
  });
  paragraph(w, text, { size: 7.5, color: GREY, font: w.regular });
}

// ── NDA ────────────────────────────────────────────────────────────────────
export interface NdaData {
  dealReference: string;
  assetTitle: string;
  assetReference: string;
  buyerName: string;
  buyerEmail: string;
  sellerName: string;
  issuedAt: Date;
  durationMonths: number;
  templateVersion: string;
}

export async function generateNdaPdf(data: NdaData): Promise<Uint8Array> {
  const w = await startDocument(
    'Acuerdo de Confidencialidad',
    `Referencia ${data.dealReference} · Plantilla ${data.templateVersion}`,
  );

  keyValue(w, 'Activo', data.assetTitle);
  keyValue(w, 'Referencia del activo', data.assetReference);
  keyValue(w, 'Parte reveladora', data.sellerName);
  keyValue(w, 'Parte receptora', `${data.buyerName} (${data.buyerEmail})`);
  keyValue(w, 'Fecha de emisión', data.issuedAt.toLocaleDateString('es-PE'));
  keyValue(w, 'Vigencia', `${data.durationMonths} meses desde la firma`);
  w.y -= 8;

  heading(w, 'Primera — Objeto');
  paragraph(w,
    'Por el presente acuerdo la Parte Receptora se obliga a mantener bajo estricta reserva toda ' +
    'información que le sea revelada por la Parte Reveladora, directamente o a través de LUXUS PERÚ S.A.C., ' +
    'en el marco de la evaluación de una eventual transacción sobre el activo identificado.');

  heading(w, 'Segunda — Información confidencial');
  paragraph(w,
    'Se considera información confidencial, de manera enunciativa y no limitativa: el precio de referencia, ' +
    'la ubicación exacta, la documentación registral, los estados financieros, contratos, información de ' +
    'clientes, valorizaciones, informes técnicos y cualquier documento alojado en el Deal Room, así como la ' +
    'existencia misma de las negociaciones.');

  heading(w, 'Tercera — Obligaciones de la Parte Receptora');
  paragraph(w,
    'La Parte Receptora se obliga a: (i) utilizar la información únicamente para evaluar la transacción; ' +
    '(ii) no reproducir, distribuir ni poner a disposición de terceros la información recibida; ' +
    '(iii) limitar el acceso a los asesores estrictamente necesarios, quienes quedarán sujetos a las mismas ' +
    'obligaciones; (iv) no eludir a la Parte Reveladora ni a LUXUS PERÚ S.A.C. contactando directamente al ' +
    'titular del activo; y (v) devolver o destruir la información al término de las negociaciones.');

  heading(w, 'Cuarta — Trazabilidad');
  paragraph(w,
    'La Parte Receptora reconoce y acepta que todo documento entregado a través del Deal Room incorpora una ' +
    'marca de agua con su identificación y la fecha de acceso, y que cada visualización y descarga queda ' +
    'registrada en un log de auditoría. Dicho registro constituye medio probatorio en caso de divulgación no ' +
    'autorizada.');

  heading(w, 'Quinta — Excepciones');
  paragraph(w,
    'No se considerará confidencial la información que sea de dominio público sin mediar incumplimiento, ' +
    'la que la Parte Receptora ya poseyera legítimamente con anterioridad acreditable, o aquella cuya ' +
    'revelación sea exigida por mandato legal o de autoridad competente, en cuyo caso deberá notificarse ' +
    'previamente a la Parte Reveladora.');

  heading(w, 'Sexta — Vigencia y ley aplicable');
  paragraph(w,
    `Las obligaciones de confidencialidad se mantendrán vigentes por ${data.durationMonths} meses contados ` +
    'desde la firma. El presente acuerdo se rige por las leyes de la República del Perú. Toda controversia ' +
    'será sometida a arbitraje de derecho ante el Centro de Arbitraje de la Cámara de Comercio de Lima.');

  heading(w, 'Séptima — Datos personales');
  paragraph(w,
    'Las partes tratarán los datos personales a los que accedan conforme a la Ley 29733, Ley de Protección de ' +
    'Datos Personales, y su reglamento, limitando su uso a la finalidad de esta evaluación.');

  signatureBlocks(w, [
    { role: 'Parte Receptora', name: data.buyerName },
    { role: 'Parte Reveladora', name: data.sellerName },
  ]);

  disclaimer(w,
    'Documento generado automáticamente por la plataforma LUXUS PERÚ. La firma se gestiona a través de un ' +
    'proveedor de firma electrónica. En el entorno de desarrollo el proveedor es simulado y el documento ' +
    'carece de efectos legales.');

  return w.pdf.save();
}

// ── LOI ────────────────────────────────────────────────────────────────────
export interface LoiData {
  dealReference: string;
  assetTitle: string;
  assetReference: string;
  buyerName: string;
  sellerName: string;
  issuedAt: Date;
  purchasePrice: string;
  structure: string;
  depositAmount?: string;
  ddPeriodDays: number;
  exclusivityDays: number;
  conditionsPrecedent: string[];
  governingLaw: string;
  disputeResolution: string;
  expiryDate: string;
  templateVersion: string;
}

export async function generateLoiPdf(data: LoiData): Promise<Uint8Array> {
  const w = await startDocument(
    'Carta de Intención (Letter of Intent)',
    `Referencia ${data.dealReference} · Plantilla ${data.templateVersion}`,
  );

  keyValue(w, 'Activo', data.assetTitle);
  keyValue(w, 'Referencia del activo', data.assetReference);
  keyValue(w, 'Comprador', data.buyerName);
  keyValue(w, 'Vendedor', data.sellerName);
  keyValue(w, 'Fecha', data.issuedAt.toLocaleDateString('es-PE'));
  keyValue(w, 'Vigencia de la oferta', data.expiryDate);
  w.y -= 8;

  heading(w, 'Primera — Términos económicos');
  keyValue(w, 'Precio ofertado', data.purchasePrice);
  keyValue(w, 'Estructura de pago', data.structure);
  if (data.depositAmount) keyValue(w, 'Depósito / arras', data.depositAmount);
  w.y -= 4;

  heading(w, 'Segunda — Due diligence y exclusividad');
  paragraph(w,
    `El Comprador dispondrá de ${data.ddPeriodDays} días calendario para completar su due diligence ` +
    `confirmatoria. Durante ${data.exclusivityDays} días calendario contados desde la firma de la presente, ` +
    'el Vendedor se abstendrá de negociar el activo con terceros.');

  heading(w, 'Tercera — Condiciones precedentes');
  if (data.conditionsPrecedent.length > 0) {
    paragraph(w, data.conditionsPrecedent.map((c, i) => `${i + 1}. ${c}`).join('\n'));
  } else {
    paragraph(w, 'No se han establecido condiciones precedentes adicionales a las de ley.');
  }

  heading(w, 'Cuarta — Naturaleza no vinculante');
  paragraph(w,
    'Salvo por las cláusulas de exclusividad, confidencialidad, ley aplicable y solución de controversias, ' +
    'que son vinculantes, la presente carta expresa la intención de las partes y no constituye obligación de ' +
    'celebrar la transacción. El acuerdo definitivo requerirá documentación contractual independiente.');

  heading(w, 'Quinta — Escrow');
  paragraph(w,
    'Los fondos de la transacción se canalizarán a través de una entidad fiduciaria o escrow independiente ' +
    'designada por las partes. LUXUS PERÚ S.A.C. no interviene en la custodia ni el movimiento de fondos, ' +
    'y no actúa como agente de pago, corredor de valores ni entidad financiera.');

  heading(w, 'Sexta — Ley aplicable y controversias');
  paragraph(w, `Ley aplicable: ${data.governingLaw}. Solución de controversias: ${data.disputeResolution}.`);

  signatureBlocks(w, [
    { role: 'Comprador', name: data.buyerName },
    { role: 'Vendedor', name: data.sellerName },
  ]);

  disclaimer(w,
    'Documento generado a partir de la plantilla de la plataforma con los términos acordados en el Deal Room. ' +
    'Debe ser revisado por los asesores legales de cada parte antes de su firma.');

  return w.pdf.save();
}
