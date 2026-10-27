/* =========================================================
   make-icons.mjs —— 零依赖生成 PWA / 分享用图标（纯 Node + zlib 手写 PNG）
   运行： node tools/make-icons.mjs
   产物： icons/icon-192.png、icon-512.png、icon-maskable-512.png、
         apple-touch-icon.png、share-1200x630.png、icon.svg、favicon.svg
   为什么自己画：项目坚持零素材、零依赖，图标也就用位图字体现场画出来，
   顺便保证「离线可安装」不依赖任何外链图片。
   ========================================================= */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- 最小 PNG 编码器 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                      // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 极简光栅画布 ---------------- */

const hex = (h) => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

class Canvas {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 4, 0);
  }
  blend(x, y, [r, g, b], a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const dstA = this.px[i + 3] / 255;
    const outA = a + dstA * (1 - a);
    if (outA <= 0) return;
    this.px[i] = Math.round((r * a + this.px[i] * dstA * (1 - a)) / outA);
    this.px[i + 1] = Math.round((g * a + this.px[i + 1] * dstA * (1 - a)) / outA);
    this.px[i + 2] = Math.round((b * a + this.px[i + 2] * dstA * (1 - a)) / outA);
    this.px[i + 3] = Math.round(outA * 255);
  }
  /** 圆形径向渐变铺底 */
  radial(cx, cy, radius, colorA, colorB) {
    const A = hex(colorA), B = hex(colorB);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const d = Math.min(1, Math.hypot(x - cx, y - cy) / radius);
        const t = d * d;
        this.blend(x, y, [
          Math.round(A[0] + (B[0] - A[0]) * t),
          Math.round(A[1] + (B[1] - A[1]) * t),
          Math.round(A[2] + (B[2] - A[2]) * t),
        ], 1);
      }
    }
  }
  /** 圆角矩形（半径 r） */
  roundRect(x0, y0, w, h, r, color, alpha = 1) {
    const c = hex(color);
    for (let y = Math.floor(y0); y < y0 + h; y++) {
      for (let x = Math.floor(x0); x < x0 + w; x++) {
        const dx = Math.max(x0 + r - x, 0, x - (x0 + w - 1 - r));
        const dy = Math.max(y0 + r - y, 0, y - (y0 + h - 1 - r));
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const a = d > r - 1 ? (r - d) : 1;      // 一点抗锯齿
        this.blend(x, y, c, Math.min(1, Math.max(0, a)) * alpha);
      }
    }
  }
  circle(cx, cy, r, color, alpha = 1) {
    const c = hex(color);
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        this.blend(x, y, c, Math.min(1, Math.max(0, r - d)) * alpha);
      }
    }
  }
  /** 位图字形（5×7） */
  glyph(ch, x0, y0, scale, color) {
    const pat = FONT[ch];
    if (!pat) return;
    const c = hex(color);
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (pat[r][col] !== '#') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            this.blend(x0 + col * scale + dx, y0 + r * scale + dy, c, 1);
          }
        }
      }
    }
  }
  toPNG() { return encodePNG(this.w, this.h, this.px); }
}

/* 5×7 位图字体（只画徽标需要的几个字形） */
const FONT = {
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  x: ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
};

/* ---------------- 图标绘制 ---------------- */

/** 主视觉：薄荷糖底 + 一张白扑克牌 + 牌面 "24"（明快糖果街机风） */
function drawEmblem(canvas, { size, contentRatio = 0.78, bg = true, round = true }) {
  const S = size;
  if (bg) canvas.radial(S * 0.42, S * 0.34, S * 0.85, '#9cf6da', '#12b98a');
  // 圆角裁切（maskable 版本用满幅方形，交给系统做遮罩）
  const cardW = S * contentRatio * 0.62;
  const cardH = cardW * 1.42;
  const cx = (S - cardW) / 2;
  const cy = (S - cardH) / 2;
  // 牌底阴影（用糖果色而不是纯黑，和界面里的落地阴影一致）
  canvas.roundRect(cx + S * 0.014, cy + S * 0.022, cardW, cardH, cardW * 0.13, '#0b8f6d', 0.34);
  // 牌面
  canvas.roundRect(cx, cy, cardW, cardH, cardW * 0.13, '#ffffff');
  canvas.roundRect(cx + cardW * 0.045, cy + cardH * 0.045, cardW * 0.91, cardH * 0.91, cardW * 0.1, '#eaf7f1', 0.8);
  // "24"
  const scale = (cardW * 0.72) / 11;
  const gw = 11 * scale;
  const gx = cx + (cardW - gw) / 2;
  const gy = cy + cardH * 0.5 - (7 * scale) / 2;
  canvas.glyph('2', gx, gy, scale, '#0b2a21');
  canvas.glyph('4', gx + 6 * scale, gy, scale, '#0b2a21');
  // 牌角花色小方块（红/黑各一个，暗示扑克）
  canvas.circle(cx + cardW * 0.19, cy + cardH * 0.17, cardW * 0.055, '#d0342e');
  canvas.circle(cx + cardW * 0.81, cy + cardH * 0.83, cardW * 0.055, '#22303a');
  // 一层薄薄的白色高光边
  canvas.roundRect(cx, cy, cardW, cardH, cardW * 0.13, '#ffffff', 0.5);
  if (round) {
    // 圆角化外框：把四角抹掉（半径 = 22%）
    const r = S * 0.22;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = Math.max(r - x, 0, x - (S - 1 - r));
        const dy = Math.max(r - y, 0, y - (S - 1 - r));
        if (Math.hypot(dx, dy) > r) {
          const i = (y * S + x) * 4;
          canvas.px[i + 3] = 0;
        }
      }
    }
  }
}

function drawShareCard(w, h) {
  const c = new Canvas(w, h);
  c.radial(w * 0.42, h * 0.3, w * 0.72, '#e6fdf5', '#c2ecdc');
  // 背景撒点（彩带）
  const colors = ['#ffc23d', '#17c99a', '#ff7a6b', '#4aa8ff', '#9b7bff'];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 90; i++) {
    c.circle(rnd() * w, rnd() * h, 3 + rnd() * 5, colors[i % colors.length], 0.5);
  }
  // 中央大牌
  const cardW = h * 0.56;
  const cardH = cardW * 1.42;
  const cx = (w - cardW) / 2;
  const cy = (h - cardH) / 2;
  c.roundRect(cx + 6, cy + 10, cardW, cardH, cardW * 0.12, '#0b8f6d', 0.3);
  c.roundRect(cx, cy, cardW, cardH, cardW * 0.12, '#ffffff');
  const scale = (cardW * 0.66) / 11;
  const gx = cx + (cardW - 11 * scale) / 2;
  const gy = cy + cardH / 2 - (7 * scale) / 2;
  c.glyph('2', gx, gy, scale, '#0b2a21');
  c.glyph('4', gx + 6 * scale, gy, scale, '#0b2a21');
  // 左右两张倒下的牌，暗示“两张牌合成”
  [-1, 1].forEach((side) => {
    const sw = cardW * 0.5;
    const sh = sw * 1.42;
    const sx = w / 2 + side * (cardW * 0.78) - sw / 2;
    const sy = h / 2 - sh / 2;
    c.roundRect(sx + 4, sy + 6, sw, sh, sw * 0.14, '#0b8f6d', 0.24);
    c.roundRect(sx, sy, sw, sh, sw * 0.14, '#f2fbf7');
    c.glyph(side < 0 ? '2' : '4', sx + sw * 0.5 - 2.5 * (sw * 0.2), sy + sh * 0.5 - 3.5 * (sw * 0.2), sw * 0.2, '#4d6f65');
  });
  // 运算符
  c.glyph('x', w / 2 - 2.5 * (h * 0.1), cy - h * 0.17, h * 0.1, '#c98a10');
  return c;
}

/* ---------------- 生成 ---------------- */

function write(name, buf) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, buf);
  console.log(`  ✓ ${name}  ${(buf.length / 1024).toFixed(1)} KB`);
}

console.log('\n生成图标');

// 192 / 512（purpose: any，圆角）
for (const size of [192, 512]) {
  const c = new Canvas(size, size);
  drawEmblem(c, { size, contentRatio: 0.8, round: true });
  write(`icon-${size}.png`, c.toPNG());
}
// maskable：满幅方形，内容缩到安全区（中心 60%）
{
  const size = 512;
  const c = new Canvas(size, size);
  drawEmblem(c, { size, contentRatio: 0.56, round: false });
  write('icon-maskable-512.png', c.toPNG());
}
// iOS 主屏图标：不透明方形（iOS 自己裁圆角）
{
  const size = 180;
  const c = new Canvas(size, size);
  drawEmblem(c, { size, contentRatio: 0.8, round: false });
  write('apple-touch-icon.png', c.toPNG());
}
// 分享卡片 1200×630
write('share-1200x630.png', drawShareCard(1200, 630).toPNG());

// SVG 版本（矢量，manifest 里可作 any 尺寸；浏览器地址栏图标也用它）
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="24Game">
  <defs>
    <radialGradient id="bg" cx="42%" cy="34%" r="85%">
      <stop offset="0%" stop-color="#9cf6da"/>
      <stop offset="100%" stop-color="#12b98a"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="158" y="96" width="208" height="295" rx="27" fill="#0b8f6d" opacity=".34"/>
  <rect x="152" y="86" width="208" height="295" rx="27" fill="#ffffff"/>
  <rect x="160" y="98" width="192" height="272" rx="20" fill="#eaf7f1"/>
  <circle cx="192" cy="136" r="11" fill="#d0342e"/>
  <circle cx="320" cy="332" r="11" fill="#22303a"/>
  <text x="256" y="268" text-anchor="middle" dominant-baseline="middle"
        font-family="-apple-system, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif"
        font-size="132" font-weight="900" fill="#0b2a21" letter-spacing="-4">24</text>
</svg>
`;
write('icon.svg', Buffer.from(svg, 'utf8'));

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#17c99a"/>
  <rect x="19" y="11" width="26" height="37" rx="4" fill="#ffffff"/>
  <text x="32" y="34" text-anchor="middle" dominant-baseline="middle"
        font-family="-apple-system, 'PingFang SC', Arial, sans-serif"
        font-size="19" font-weight="900" fill="#0b2a21">24</text>
</svg>
`;
write('favicon.svg', Buffer.from(favicon, 'utf8'));

console.log('\n图标生成完毕 → icons/\n');
