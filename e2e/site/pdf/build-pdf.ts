const encoder = new TextEncoder();

export type PdfObject = string | Uint8Array;

/** Serialises numbered objects (1-based; the last must be the Info dictionary and object 1 the Catalog) into a PDF 1.4 file. */
export function assemble(objects: PdfObject[]): Uint8Array {
  const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const bytes = typeof body === 'string' ? encoder.encode(body) : body;
    for (const part of [encoder.encode(`${index + 1} 0 obj\n`), bytes, encoder.encode('\nendobj\n')]) {
      parts.push(part);
      length += part.length;
    }
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(encoder.encode(xref));
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const stream = (dictionary: string, data: string) => `<< ${dictionary} /Length ${data.length} >>\nstream\n${data}\nendstream`;

/** A PDF whose pages each show the given lines of Helvetica text (ASCII only, no parentheses). */
export function textPdf(title: string, pages: string[][]): Uint8Array {
  const first = 3;
  const kids = pages.map((_, index) => `${first + index * 2} 0 R`).join(' ');
  const font = first + pages.length * 2;
  const objects: PdfObject[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
  ];
  pages.forEach((lines, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${first + index * 2 + 1} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      stream('', `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET`),
    );
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Title (${title}) >>`);
  return assemble(objects);
}

/** A PDF whose only page content is a one-pixel image, scaled up: there is no text layer. */
export function scannedPdf(title: string): Uint8Array {
  return assemble([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    stream('', 'q 400 0 0 400 100 200 cm /Im1 Do Q'),
    stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', '\u0000'),
    `<< /Title (${title}) >>`,
  ]);
}
