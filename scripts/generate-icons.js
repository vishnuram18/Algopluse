// Run: node scripts/generate-icons.js
// Generates all app icon sizes from an inline SVG candlestick design.
// Requires: npm install --save-dev sharp

const sharp = require('sharp');
const path  = require('path');

const OUT = path.join(__dirname, '..', 'assets', 'images');

// ── SVG design ────────────────────────────────────────────────────────────────
// 5 candlesticks on a dark navy background.
// Overall trend: down → up (net bullish chart pattern).
// Candle math:
//   scale(price) = 874 - (price / 100) * 724   (y=150 → price 100, y=874 → price 0)
// Verified pixel positions:
//   price 96 → y=180   price 92 → y=208   price 91 → y=215
//   price 90 → y=222   price 85 → y=259   price 78 → y=309
//   price 75 → y=331   price 70 → y=367   price 68 → y=382
//   price 62 → y=425   price 56 → y=469   price 50 → y=512
//   price 45 → y=548   price 43 → y=563

const GREEN = '#10B981';
const RED   = '#EF4444';
const GRID  = '#1E3A5F';

// Candle pixel positions — price range 30–100, y = 874 - ((p-30)/70)*724, then +47 to centre
// Verified: chart spans y=238 (candle5 wick top) to y=787 (candle1 wick bottom) → centre ≈ 512
const svgFull = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0A1628"/>
      <stop offset="100%" stop-color="#111F35"/>
    </linearGradient>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>

  <!-- Subtle horizontal grid lines (at p=85, p=70, p=56) -->
  <line x1="120" y1="352" x2="904" y2="352" stroke="${GRID}" stroke-width="2" opacity="0.5"/>
  <line x1="120" y1="507" x2="904" y2="507" stroke="${GRID}" stroke-width="2" opacity="0.5"/>
  <line x1="120" y1="653" x2="904" y2="653" stroke="${GRID}" stroke-width="2" opacity="0.5"/>

  <!-- Candle 1: Red (open=70, close=50, high=78, low=43) -->
  <line x1="220" y1="424" x2="220" y2="787" stroke="${RED}" stroke-width="10" stroke-linecap="round"/>
  <rect x="165" y="507" width="110" height="207" rx="7" fill="${RED}"/>

  <!-- Candle 2: Green small (open=50, close=62, high=68, low=45) -->
  <line x1="366" y1="528" x2="366" y2="766" stroke="${GREEN}" stroke-width="10" stroke-linecap="round"/>
  <rect x="311" y="590" width="110" height="124" rx="7" fill="${GREEN}"/>

  <!-- Candle 3: Green large (open=62, close=85, high=91, low=56) -->
  <line x1="512" y1="290" x2="512" y2="653" stroke="${GREEN}" stroke-width="10" stroke-linecap="round"/>
  <rect x="457" y="352" width="110" height="238" rx="7" fill="${GREEN}"/>

  <!-- Candle 4: Red small (open=85, close=75, high=90, low=70) -->
  <line x1="658" y1="300" x2="658" y2="507" stroke="${RED}" stroke-width="10" stroke-linecap="round"/>
  <rect x="603" y="352" width="110" height="104" rx="7" fill="${RED}"/>

  <!-- Candle 5: Green (open=75, close=92, high=96, low=70) -->
  <line x1="804" y1="238" x2="804" y2="507" stroke="${GREEN}" stroke-width="10" stroke-linecap="round"/>
  <rect x="749" y="280" width="110" height="176" rx="7" fill="${GREEN}"/>
</svg>`;

// Adaptive icon: same design but chart elements scaled to 72% of canvas
// so everything stays within Android's guaranteed safe zone (inner 66%).
const svgAdaptive = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0A1628"/>
      <stop offset="100%" stop-color="#111F35"/>
    </linearGradient>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>

  <g transform="translate(128, 128) scale(0.75)">
    <!-- Grid lines -->
    <line x1="120" y1="352" x2="904" y2="352" stroke="${GRID}" stroke-width="2.5" opacity="0.5"/>
    <line x1="120" y1="507" x2="904" y2="507" stroke="${GRID}" stroke-width="2.5" opacity="0.5"/>
    <line x1="120" y1="653" x2="904" y2="653" stroke="${GRID}" stroke-width="2.5" opacity="0.5"/>

    <!-- Candle 1: Red -->
    <line x1="220" y1="424" x2="220" y2="787" stroke="${RED}" stroke-width="13" stroke-linecap="round"/>
    <rect x="165" y="507" width="110" height="207" rx="7" fill="${RED}"/>

    <!-- Candle 2: Green small -->
    <line x1="366" y1="528" x2="366" y2="766" stroke="${GREEN}" stroke-width="13" stroke-linecap="round"/>
    <rect x="311" y="590" width="110" height="124" rx="7" fill="${GREEN}"/>

    <!-- Candle 3: Green large -->
    <line x1="512" y1="290" x2="512" y2="653" stroke="${GREEN}" stroke-width="13" stroke-linecap="round"/>
    <rect x="457" y="352" width="110" height="238" rx="7" fill="${GREEN}"/>

    <!-- Candle 4: Red small -->
    <line x1="658" y1="300" x2="658" y2="507" stroke="${RED}" stroke-width="13" stroke-linecap="round"/>
    <rect x="603" y="352" width="110" height="104" rx="7" fill="${RED}"/>

    <!-- Candle 5: Green -->
    <line x1="804" y1="238" x2="804" y2="507" stroke="${GREEN}" stroke-width="13" stroke-linecap="round"/>
    <rect x="749" y="280" width="110" height="176" rx="7" fill="${GREEN}"/>
  </g>
</svg>`;

async function generate() {
  const buf     = Buffer.from(svgFull.trim());
  const bufAdap = Buffer.from(svgAdaptive.trim());

  await sharp(buf).resize(1024, 1024).png().toFile(path.join(OUT, 'icon.png'));
  console.log('✓ icon.png');

  await sharp(bufAdap).resize(1024, 1024).png().toFile(path.join(OUT, 'adaptive-icon.png'));
  console.log('✓ adaptive-icon.png');

  await sharp(buf).resize(512, 512).png().toFile(path.join(OUT, 'splash-icon.png'));
  console.log('✓ splash-icon.png');

  await sharp(buf).resize(64, 64).png().toFile(path.join(OUT, 'favicon.png'));
  console.log('✓ favicon.png');

  console.log('\nAll icons generated in assets/images/');
}

generate().catch(err => { console.error(err); process.exit(1); });
