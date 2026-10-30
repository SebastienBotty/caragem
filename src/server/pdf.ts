import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { money, totals, type Document, type GarageState } from '../lib/domain.ts';

export async function documentPdf(s: GarageState, d: Document) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.17, 0.23, 0.33);
  const muted = rgb(0.48, 0.55, 0.65);
  const blue = rgb(0.27, 0.41, 0.86);
  const safe = (input: string) =>
    Array.from(input.replaceAll('\u202f', ' ').replaceAll('\u00a0', ' ').replaceAll('\n', ' '))
      .map((c) => {
        try {
          font.encodeText(c);
          return c;
        } catch {
          return '?';
        }
      })
      .join('');
  let page = pdf.addPage([595.28, 841.89]);
  let y = 785;
  const newPage = () => {
    page = pdf.addPage([595.28, 841.89]);
    y = 785;
  };
  const text = (label: string, x = 45, size = 10, heavy = false, color = ink) => {
    page.drawText(safe(label), {
      x,
      y,
      size,
      font: heavy ? bold : font,
      color,
    });
  };
  const wrapped = (input: string, width: number, size = 10) => {
    const lines: string[] = [];
    let current = '';
    for (const word of safe(input).split(/\s+/)) {
      for (const chunk of word.match(/.{1,45}/g) ?? ['']) {
        const candidate = current ? current + ' ' + chunk : chunk;
        if (font.widthOfTextAtSize(candidate, size) > width && current) {
          lines.push(current);
          current = chunk;
        } else current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  };
  const line = () => {
    page.drawLine({
      start: { x: 45, y },
      end: { x: 550, y },
      thickness: 0.7,
      color: rgb(0.88, 0.91, 0.95),
    });
  };
  const vehicle = s.vehicles.find((v) => v.id === d.vehicleId)!;
  const customer = s.customers.find((c) => c.id === vehicle.customerId)!;
  text('Caragem', 45, 27, true, blue);
  text('BROUILLON DE TRAVAIL - MVP', 330, 10, true, muted);
  y -= 42;
  for (const name of wrapped(s.settings.name, 500, 17)) {
    text(name, 45, 17, true);
    y -= 23;
  }
  for (const label of [s.settings.address, s.settings.businessId].filter(Boolean)) {
    for (const chunk of wrapped(label, 500)) {
      text(chunk, 45, 10, false, muted);
      y -= 16;
    }
  }
  y -= 20;
  text(`${d.kind === 'estimate' ? 'DEVIS' : 'FACTURE'} ${d.number}`, 45, 17, true);
  y -= 22;
  text(new Date(d.createdAt).toLocaleDateString('fr-FR'), 45, 10, false, muted);
  y -= 30;
  for (const label of [
    customer.name,
    customer.email,
    `${vehicle.model} - ${vehicle.plate}`,
    `${vehicle.mileage.toLocaleString('fr-FR')} km - visite ${vehicle.visit}`,
  ]) {
    for (const chunk of wrapped(label, 500)) {
      text(chunk);
      y -= 16;
    }
  }
  y -= 20;
  line();
  y -= 21;
  text('DESIGNATION', 45, 9, true, muted);
  text('QTE', 350, 9, true, muted);
  text('P.U. HT', 400, 9, true, muted);
  text('TOTAL HT', 485, 9, true, muted);
  y -= 17;
  line();
  y -= 24;
  for (const item of d.lines) {
    const rows = wrapped(item.label, 280);
    const height = Math.max(1, rows.length) * 15 + 18;
    if (y - height < 95) newPage();
    const baseY = y;
    rows.forEach((label, i) => {
      y = baseY - i * 15;
      text(label, 45, 10);
    });
    y = baseY;
    text(String(item.quantity), 350, 10);
    text(money(item.unitPrice), 400, 10);
    text(money(Math.round(item.quantity * item.unitPrice)), 485, 10);
    y = baseY - height;
    line();
    y -= 15;
  }
  if (y < 260) newPage();
  const t = totals(d.lines, d.taxRate, d.discountRate, d.discountAmount);
  for (const [label, amount] of [
    ...((d.discountRate ?? 0) > 0 || (d.discountAmount ?? 0) > 0
      ? [
          ['Sous-total HT', t.subtotal],
          [d.discountAmount ? 'Ristourne (EUR)' : `Ristourne (${d.discountRate} %)`, -t.discount],
        ]
      : []),
    ['Total HT', t.net],
    [`TVA (${d.taxRate} %)`, t.tax],
    ['Total TTC', t.gross],
    ...(d.kind === 'invoice'
      ? [
          ['Deja regle', d.paid],
          ['Reste a regler', t.gross - d.paid],
        ]
      : []),
  ] as [string, number][]) {
    text(label, 340, 11, label === 'Total TTC');
    text(money(amount), 470, 11, label === 'Total TTC');
    y -= 23;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(
      'Document de travail. Conformite et mentions de facturation a valider avant usage commercial.',
      { x: 45, y: 46, size: 8, font, color: muted },
    );
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: 520,
      y: 30,
      size: 8,
      font,
      color: muted,
    });
  });
  pdf.setTitle(`${d.number} - Brouillon`);
  pdf.setAuthor(s.settings.name);
  return pdf.save();
}
