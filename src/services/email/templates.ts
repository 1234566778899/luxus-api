import type { EmailMessage } from './types.js';

const NAVY = '#181818';
const GOLD = '#0F6E6E';

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:Georgia,'Times New Roman',serif;color:${NAVY};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E5E5E5;">
        <tr><td style="padding:32px 40px 24px;border-bottom:1px solid #E5E5E5;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:${NAVY};">LUXUS&nbsp;PERÚ</div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${GOLD};margin-top:6px;">Exceptional Assets · Private Transactions</div>
        </td></tr>
        <tr><td style="padding:32px 40px;font-size:16px;line-height:1.65;">
          <h1 style="margin:0 0 20px;font-size:22px;font-weight:400;line-height:1.3;">${title}</h1>
          ${bodyHtml}
          ${cta ? `<p style="margin:32px 0 0;"><a href="${cta.url}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">${cta.label}</a></p>` : ''}
        </td></tr>
        <tr><td style="padding:24px 40px 32px;border-top:1px solid #E5E5E5;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.7;color:#6B6B6B;">
          Este mensaje contiene información reservada dirigida únicamente a su destinatario.<br>
          LUXUS PERÚ S.A.C. · Av. Santa Cruz 1250, San Isidro, Lima · private@luxusperu.com<br>
          Puede ajustar sus preferencias de notificación desde su perfil.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;">${text}</p>`;
}

const s = (data: Record<string, unknown>, key: string, fallback = ''): string =>
  data[key] === undefined || data[key] === null ? fallback : String(data[key]);

/**
 * Render de plantillas. Sin dependencias externas a propósito: el contenido de
 * estos correos es sobrio y estable, y así no hay motor de plantillas que
 * mantener ni superficie de inyección.
 */
export function renderTemplate(message: EmailMessage, siteUrl: string): Rendered {
  const d = message.data;
  const name = s(d, 'name', 'Estimado cliente');

  switch (message.template) {
    case 'private_access_approved':
      return {
        subject: 'Su acceso privado a LUXUS PERÚ ha sido aprobado',
        html: layout(
          'Su acceso ha sido aprobado',
          p(`${name}, su solicitud de acceso privado ha sido aprobada.`) +
            p('Reciba en un mensaje aparte la invitación para establecer su contraseña. Tras el primer ingreso deberá activar la verificación en dos pasos y completar el proceso de verificación de identidad.'),
          { label: 'Acceder', url: `${siteUrl}/auth/login` },
        ),
        text: `${name}, su solicitud de acceso privado a LUXUS PERÚ ha sido aprobada. Acceda en ${siteUrl}/auth/login`,
      };

    case 'private_access_rejected':
      return {
        subject: 'Sobre su solicitud de acceso a LUXUS PERÚ',
        html: layout(
          'Sobre su solicitud',
          p(`${name}, hemos revisado su solicitud de acceso.`) +
            p('En esta oportunidad no podemos incorporarle a la plataforma. Nuestro inventario es limitado y la admisión se evalúa caso por caso. Agradecemos su interés.'),
        ),
        text: `${name}, hemos revisado su solicitud de acceso a LUXUS PERÚ y en esta oportunidad no podemos incorporarle.`,
      };

    case 'kyc_approved':
      return {
        subject: 'Verificación aprobada — acceso Nivel II activo',
        html: layout(
          'Verificación aprobada',
          p(`${name}, su verificación de identidad fue aprobada.`) +
            p('Ya puede consultar el precio de referencia y la ubicación real de los activos, así como solicitar acceso a Deal Rooms.'),
          { label: 'Ir a mi panel', url: `${siteUrl}/dashboard` },
        ),
        text: `${name}, su verificación fue aprobada. Acceda en ${siteUrl}/dashboard`,
      };

    case 'kyc_rejected':
      return {
        subject: 'Su verificación requiere atención',
        html: layout(
          'Verificación no completada',
          p(`${name}, no pudimos completar su verificación.`) +
            p(`Motivo: ${s(d, 'reason', 'documentación insuficiente')}.`) +
            p('Puede volver a enviar la documentación desde su panel.'),
          { label: 'Reintentar verificación', url: `${siteUrl}/onboarding/kyc` },
        ),
        text: `${name}, no pudimos completar su verificación. Motivo: ${s(d, 'reason')}.`,
      };

    case 'kyc_manual_review':
      return {
        subject: 'Su verificación está en revisión',
        html: layout(
          'Verificación en revisión',
          p(`${name}, su expediente pasó a revisión manual por nuestro equipo de cumplimiento.`) +
            p('Le informaremos en cuanto haya una decisión. No es necesario que envíe nada más por ahora.'),
        ),
        text: `${name}, su verificación pasó a revisión manual.`,
      };

    case 'deal_access_requested':
      return {
        subject: `Nueva solicitud de Deal Room — ${s(d, 'assetTitle')}`,
        html: layout(
          'Nueva solicitud de acceso',
          p(`Ha recibido una solicitud de acceso al Deal Room de <strong>${s(d, 'assetTitle')}</strong>.`) +
            p(`Solicitante: ${s(d, 'buyerName')} · Verificación: ${s(d, 'kycStatus', 'aprobada')}`) +
            p(s(d, 'message') ? `«${s(d, 'message')}»` : ''),
          { label: 'Revisar solicitud', url: `${siteUrl}/dashboard/seller/requests` },
        ),
        text: `Nueva solicitud de Deal Room para ${s(d, 'assetTitle')} de ${s(d, 'buyerName')}.`,
      };

    case 'deal_access_approved':
      return {
        subject: `Acceso concedido — ${s(d, 'assetTitle')}`,
        html: layout(
          'Acceso concedido',
          p(`${name}, el vendedor concedió su solicitud de acceso al Deal Room de <strong>${s(d, 'assetTitle')}</strong>.`) +
            p('El siguiente paso es la firma del acuerdo de confidencialidad. Hasta entonces la documentación permanece cerrada.'),
          { label: 'Firmar NDA', url: `${siteUrl}/deal/${s(d, 'dealId')}` },
        ),
        text: `${name}, su acceso al Deal Room de ${s(d, 'assetTitle')} fue concedido. Firme el NDA en ${siteUrl}/deal/${s(d, 'dealId')}`,
      };

    case 'deal_access_declined':
      return {
        subject: `Sobre su solicitud — ${s(d, 'assetTitle')}`,
        html: layout(
          'Solicitud no concedida',
          p(`${name}, el vendedor no concedió el acceso al Deal Room de <strong>${s(d, 'assetTitle')}</strong>.`) +
            p(s(d, 'reason') ? `Motivo indicado: ${s(d, 'reason')}` : ''),
        ),
        text: `${name}, su solicitud sobre ${s(d, 'assetTitle')} no fue concedida.`,
      };

    case 'nda_pending':
      return {
        subject: `NDA pendiente de firma — ${s(d, 'assetTitle')}`,
        html: layout(
          'Acuerdo de confidencialidad pendiente',
          p(`${name}, el acuerdo de confidencialidad de <strong>${s(d, 'assetTitle')}</strong> está listo para su firma.`) +
            p('El Deal Room se abrirá inmediatamente después de la firma.'),
          { label: 'Revisar y firmar', url: `${siteUrl}/deal/${s(d, 'dealId')}` },
        ),
        text: `${name}, el NDA de ${s(d, 'assetTitle')} está pendiente de firma.`,
      };

    case 'nda_signed':
      return {
        subject: `NDA firmado — Deal Room abierto`,
        html: layout(
          'Deal Room abierto',
          p(`El acuerdo de confidencialidad de <strong>${s(d, 'assetTitle')}</strong> fue firmado por ${s(d, 'signerName')}.`) +
            p('La documentación autorizada ya está disponible según los permisos concedidos.'),
          { label: 'Abrir Deal Room', url: `${siteUrl}/deal/${s(d, 'dealId')}` },
        ),
        text: `NDA firmado. Deal Room abierto para ${s(d, 'assetTitle')}.`,
      };

    case 'qa_new_message':
      return {
        subject: `Nueva pregunta en el Deal Room — ${s(d, 'assetTitle')}`,
        html: layout(
          'Nueva actividad en Q&A',
          p(`<strong>${s(d, 'authorName')}</strong> escribió en el hilo «${s(d, 'subject')}».`) +
            p(`«${s(d, 'preview')}»`),
          { label: 'Responder', url: `${siteUrl}/deal/${s(d, 'dealId')}#qa` },
        ),
        text: `Nueva pregunta de ${s(d, 'authorName')} en ${s(d, 'subject')}.`,
      };

    case 'offer_received':
      return {
        subject: `Oferta recibida — ${s(d, 'assetTitle')}`,
        html: layout(
          'Oferta recibida',
          p(`Ha recibido una oferta de <strong>${s(d, 'amount')}</strong> por ${s(d, 'assetTitle')}.`) +
            p(`Vigencia: ${s(d, 'validUntil', 'sin plazo indicado')}`),
          { label: 'Revisar oferta', url: `${siteUrl}/deal/${s(d, 'dealId')}#offers` },
        ),
        text: `Oferta recibida de ${s(d, 'amount')} por ${s(d, 'assetTitle')}.`,
      };

    case 'offer_response':
      return {
        subject: `Respuesta a su oferta — ${s(d, 'assetTitle')}`,
        html: layout(
          'Respuesta a su oferta',
          p(`Su oferta por <strong>${s(d, 'assetTitle')}</strong> recibió respuesta: ${s(d, 'action')}.`) +
            p(s(d, 'note') ? `«${s(d, 'note')}»` : ''),
          { label: 'Ver detalle', url: `${siteUrl}/deal/${s(d, 'dealId')}#offers` },
        ),
        text: `Su oferta por ${s(d, 'assetTitle')}: ${s(d, 'action')}.`,
      };

    case 'loi_ready':
      return {
        subject: 'Carta de intención lista para firma',
        html: layout(
          'Carta de intención',
          p(`La LOI de <strong>${s(d, 'assetTitle')}</strong> fue generada con los términos acordados y está lista para firma.`),
          { label: 'Revisar LOI', url: `${siteUrl}/deal/${s(d, 'dealId')}#loi` },
        ),
        text: `La LOI de ${s(d, 'assetTitle')} está lista para firma.`,
      };

    case 'permission_expiring':
      return {
        subject: 'Un acceso documental vence pronto',
        html: layout(
          'Acceso próximo a vencer',
          p(`${name}, su acceso a ${s(d, 'documentCount', '1')} documento(s) del Deal Room de <strong>${s(d, 'assetTitle')}</strong> vence el ${s(d, 'expiresAt')}.`) +
            p('Si necesita una prórroga, solicítela al vendedor desde el Deal Room.'),
          { label: 'Abrir Deal Room', url: `${siteUrl}/deal/${s(d, 'dealId')}` },
        ),
        text: `${name}, su acceso documental vence el ${s(d, 'expiresAt')}.`,
      };

    case 'permission_expired':
      return {
        subject: 'Acceso documental vencido',
        html: layout(
          'Acceso vencido',
          p(`${name}, su acceso a documentación de <strong>${s(d, 'assetTitle')}</strong> ha vencido y fue revocado automáticamente.`),
          { label: 'Solicitar prórroga', url: `${siteUrl}/deal/${s(d, 'dealId')}` },
        ),
        text: `${name}, su acceso documental ha vencido.`,
      };

    case 'asset_published':
      return {
        subject: `Su activo fue publicado — ${s(d, 'assetTitle')}`,
        html: layout(
          'Activo publicado',
          p(`<strong>${s(d, 'assetTitle')}</strong> superó la verificación y ya está publicado.`),
          { label: 'Ver ficha', url: `${siteUrl}/asset/${s(d, 'slug')}` },
        ),
        text: `${s(d, 'assetTitle')} fue publicado.`,
      };

    case 'asset_changes_requested':
      return {
        subject: `Cambios requeridos — ${s(d, 'assetTitle')}`,
        html: layout(
          'Cambios requeridos',
          p(`La revisión de <strong>${s(d, 'assetTitle')}</strong> requiere ajustes antes de publicar.`) +
            p(`Observaciones: ${s(d, 'reason')}`),
          { label: 'Editar activo', url: `${siteUrl}/dashboard/seller/assets` },
        ),
        text: `Cambios requeridos en ${s(d, 'assetTitle')}: ${s(d, 'reason')}`,
      };

    case 'payment_receipt':
      return {
        subject: `Recibo ${s(d, 'receiptNumber')} — LUXUS PERÚ`,
        html: layout(
          'Recibo de pago',
          p(`${name}, confirmamos el pago de <strong>${s(d, 'amount')}</strong> por ${s(d, 'description')}.`) +
            p(`Número de recibo: ${s(d, 'receiptNumber')}`),
          { label: 'Ver facturación', url: `${siteUrl}/dashboard/billing` },
        ),
        text: `Pago de ${s(d, 'amount')} confirmado. Recibo ${s(d, 'receiptNumber')}.`,
      };

    case 'subscription_past_due':
      return {
        subject: 'Su suscripción requiere atención',
        html: layout(
          'Pago pendiente',
          p(`${name}, no pudimos procesar el cobro de su ${s(d, 'planName')}.`) +
            p('Actualice su método de pago para mantener su acceso activo.'),
          { label: 'Actualizar pago', url: `${siteUrl}/dashboard/billing` },
        ),
        text: `${name}, no pudimos procesar el cobro de su ${s(d, 'planName')}.`,
      };

    case 'complaint_received':
      return {
        subject: `Hemos recibido su ${s(d, 'kindLabel', 'reclamo')} — ${s(d, 'reference')}`,
        html: layout(
          'Hemos recibido su registro',
          p(`${name}, registramos su ${s(d, 'kindLabel', 'reclamo')} en nuestro Libro de Reclamaciones con el número <strong>${s(d, 'reference')}</strong>.`) +
            p(`Le daremos respuesta en un plazo no mayor a 30 días calendario, conforme a la normativa de protección al consumidor.`) +
            p(`Detalle registrado: "${s(d, 'detail')}"`),
        ),
        text: `${name}, su ${s(d, 'kindLabel', 'reclamo')} quedó registrado con el número ${s(d, 'reference')}. Le responderemos en un plazo no mayor a 30 días calendario.`,
      };

    case 'complaint_responded':
      return {
        subject: `Respuesta a su ${s(d, 'kindLabel', 'reclamo')} ${s(d, 'reference')}`,
        html: layout(
          'Respuesta a su registro',
          p(`${name}, esta es nuestra respuesta a su ${s(d, 'kindLabel', 'reclamo')} <strong>${s(d, 'reference')}</strong>:`) +
            p(s(d, 'responseText')),
        ),
        text: `Respuesta a su ${s(d, 'kindLabel', 'reclamo')} ${s(d, 'reference')}: ${s(d, 'responseText')}`,
      };

    default: {
      const exhaustive: never = message.template;
      throw new Error(`Plantilla de correo no implementada: ${String(exhaustive)}`);
    }
  }
}
