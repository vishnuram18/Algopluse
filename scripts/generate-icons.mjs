import sharp from 'sharp';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets   = path.join(__dirname, '..', 'assets', 'images');

// ── AlgoPulse logo SVG ────────────────────────────────────────────────────────
// Forest green bg · white ECG pulse waveform · "AP" wordmark below

function logoSvg(size, { rounded = false, bgColor = '#3F5E4C', fgColor = '#FFFFFF' } = {}) {
  const r  = rounded ? Math.round(size * 0.18) : 0;
  const cx = size / 2;

  // Pulse path: flat → spike up → spike down → flat (centred on canvas)
  const y  = size * 0.42;   // baseline
  const amplitude = size * 0.22;
  const segW = size * 0.072;

  const p = [
    [cx - segW * 4.5, y],
    [cx - segW * 1.8, y],
    [cx - segW * 0.9, y - amplitude * 0.35],
    [cx,              y + amplitude],
    [cx + segW * 0.9, y - amplitude],
    [cx + segW * 1.8, y],
    [cx + segW * 4.5, y],
  ].map(([x, py]) => `${x.toFixed(1)},${py.toFixed(1)}`).join(' ');

  const sw  = size * 0.055;   // stroke width
  const fs  = size * 0.115;   // font size
  const ty  = size * 0.76;    // text y

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${r}" fill="${bgColor}"/>
  <polyline
    points="${p}"
    fill="none"
    stroke="${fgColor}"
    stroke-width="${sw}"
    stroke-linecap="round"
    stroke-linejoin="round"
    opacity="0.95"
  />
  <text
    x="${cx}"
    y="${ty}"
    text-anchor="middle"
    font-family="'Arial', 'Helvetica', sans-serif"
    font-weight="700"
    font-size="${fs}"
    fill="${fgColor}"
    letter-spacing="${size * 0.018}"
    opacity="0.9"
  >ALGOPULSE</text>
</svg>`;
}

async function generate(svgStr, outPath, size) {
  await sharp(Buffer.from(svgStr))
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`✔  ${path.basename(outPath)}  (${size}×${size})`);
}

// ── App icon  (square, for store / Expo) ─────────────────────────────────────
await generate(
  logoSvg(1024, { rounded: false }),
  path.join(assets, 'icon.png'),
  1024
);

// ── Adaptive icon foreground (Android, transparent bg recommended) ────────────
await generate(
  logoSvg(1024, { rounded: false, bgColor: '#3F5E4C' }),
  path.join(assets, 'adaptive-icon.png'),
  1024
);

// ── Splash icon (centred on white canvas) ────────────────────────────────────
const splashIconSvg = logoSvg(512, { rounded: true });
const splashSvg = `<svg width="1284" height="2778" viewBox="0 0 1284 2778" xmlns="http://www.w3.org/2000/svg">
  <rect width="1284" height="2778" fill="#FBF9F6"/>
  <image href="data:image/svg+xml;base64,${Buffer.from(splashIconSvg).toString('base64')}"
         x="${(1284-512)/2}" y="${(2778-512)/2}" width="512" height="512"/>
</svg>`;
await generate(splashSvg, path.join(assets, 'splash-icon.png'), 1284);

// ── Favicon (web) ─────────────────────────────────────────────────────────────
await generate(
  logoSvg(64, { rounded: true }),
  path.join(assets, 'favicon.png'),
  64
);

console.log('\nAll icons generated successfully.');
