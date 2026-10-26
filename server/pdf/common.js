import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(here, '..', 'fonts');

const FAMILIES = {
  inter: 'Inter',
  manrope: 'Manrope',
  serif: 'SourceSerif4',
};

export function registerFonts(doc, family = 'inter') {
  const name = FAMILIES[family] || FAMILIES.inter;
  doc.registerFont('R', path.join(FONT_DIR, `${name}-400.ttf`));
  doc.registerFont('M', path.join(FONT_DIR, `${name}-600.ttf`));
  doc.registerFont('B', path.join(FONT_DIR, `${name}-700.ttf`));
  // Body text always readable sans for numbers in serif mode too
  doc.registerFont('N', path.join(FONT_DIR, `Inter-400.ttf`));
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = parseInt(m ? m[1] : '4f46e5', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function tint(hex, amount) {
  // amount 0..1 → mix with white
  const [r, g, b] = hexToRgb(hex);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
export function safeHex(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#4f46e5';
}

export function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
