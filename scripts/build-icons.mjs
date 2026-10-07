import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'desktop/assets');
const iconset = path.join(root, 'desktop/build/ContextLens.iconset');
mkdirSync(assets, { recursive: true }); mkdirSync(iconset, { recursive: true });
const source = readFileSync(path.join(root, 'web/app-icon.svg'), 'utf8');
const png = size => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
writeFileSync(path.join(assets, 'ContextLens.png'), png(1024));
cpSync(path.join(root, 'web/app-icon.svg'), path.join(assets, 'ContextLens.svg'));
for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), png(size));
  writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), png(size * 2));
}
// ICO stores independent PNG images, preserving crisp rings at every Windows shell size.
const images = [16, 24, 32, 48, 64, 128, 256].map(size => ({ size, bytes: png(size) }));
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const entries = images.map(({ size, bytes }) => {
  const item = Buffer.alloc(16); item[0] = item[1] = size === 256 ? 0 : size;
  item.writeUInt16LE(1, 4); item.writeUInt16LE(32, 6); item.writeUInt32LE(bytes.length, 8); item.writeUInt32LE(offset, 12); offset += bytes.length;
  return item;
});
writeFileSync(path.join(assets, 'ContextLens.ico'), Buffer.concat([header, ...entries, ...images.map(image => image.bytes)]));
const tray = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="none" stroke="#172d45" stroke-width="3"/><circle cx="16" cy="16" r="4" fill="#172d45"/><circle cx="25" cy="6" r="3" fill="#287ee3"/></svg>';
writeFileSync(path.join(assets, 'tray.png'), new Resvg(tray).render().asPng());
if (process.platform === 'darwin') execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'ContextLens.icns')]);
console.log(path.join(assets, 'ContextLens.png'));
