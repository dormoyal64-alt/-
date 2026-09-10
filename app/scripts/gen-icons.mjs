import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('public/icons', { recursive: true });

const svgPath = 'scripts/icon-source.svg';

const targets = [
  { name: 'icon-192.png', size: 192, pad: 0 },
  { name: 'icon-512.png', size: 512, pad: 0 },
  { name: 'maskable-192.png', size: 192, pad: 48 },
  { name: 'maskable-512.png', size: 512, pad: 128 },
  { name: 'apple-touch-icon.png', size: 180, pad: 0 },
];

for (const t of targets) {
  const inner = t.size - t.pad * 2;
  const base = sharp({
    create: {
      width: t.size,
      height: t.size,
      channels: 4,
      background: '#0b2545',
    },
  });
  const iconBuf = await sharp(svgPath).resize(inner, inner).toBuffer();
  await base
    .composite([{ input: iconBuf, top: t.pad, left: t.pad }])
    .png()
    .toFile(`public/icons/${t.name}`);
  console.log('wrote', t.name);
}
