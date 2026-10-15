export function samplePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    'stream\nBT /F1 30 Tf 60 310 Td (Search platform update) Tj 0 -60 Td /F1 20 Tf (Response time: 800ms to 300ms) Tj ET\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    'stream\nBT /F1 30 Tf 60 310 Td (Next steps) Tj 0 -60 Td /F1 20 Tf (Pilot: next month. Cost: to be confirmed.) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ].map((x) => (x.startsWith('stream') ? `<< /Length ${x.slice(7, -10).length} >>\n${x}` : x));
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = text.length;
  text +=
    `xref\n0 8\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('');
  text += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}
