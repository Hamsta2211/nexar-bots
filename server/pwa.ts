import zlib from "node:zlib";
import type { Express } from "express";

// App-Icons für die Installation als App (PWA). Werden beim ersten Aufruf als PNG gezeichnet,
// damit keine Binärdateien im Repo liegen müssen.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size: number, rgb: Uint8Array): Buffer {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * size * 3, size * 3).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG_TOP = hex("#1b2331");
const BG_BOT = hex("#121821");
const GHOST = hex("#aeb5be");
const GHOST_LOW = hex("#98a0aa");
const WHITE = hex("#f1f3f5");
const DARK = hex("#1b2029");

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Farbe an einem Punkt in Geister-Koordinaten (u, v)
function ghostColor(u: number, v: number): RGB | null {
  const inCircle = u * u + (v + 0.25) * (v + 0.25) <= 0.64;
  let inRect = Math.abs(u) <= 0.8 && v >= -0.25 && v <= 0.75;
  if (inRect && v > 0.53) {
    const du = Math.abs(u) - 0.58, dv = v - 0.53;
    if (du > 0 && du * du + dv * dv > 0.0484) inRect = false;
  }
  if (!inCircle && !inRect) return null;
  for (const sx of [-1, 1]) {
    const ex = sx * 0.34;
    if (Math.hypot(u - (ex + sx * 0.04), v + 0.07) <= 0.11) return DARK;
    if (Math.hypot(u - ex, v + 0.12) <= 0.25) return WHITE;
  }
  // wütende Augenbrauen: innen tiefer
  for (const sx of [-1, 1]) {
    if (segDist(u, v, sx * 0.72, -0.52, sx * 0.1, -0.3) <= 0.07) return DARK;
  }
  return v > 0.35 ? GHOST_LOW : GHOST;
}

function renderIcon(size: number, scale: number): Buffer {
  const rgb = new Uint8Array(size * size * 3);
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) / size - 0.5;
          const fy = (y + (sy + 0.5) / SS) / size - 0.5;
          const c = ghostColor(fx / scale, fy / scale - 0.15);
          if (c) { r += c[0]; g += c[1]; b += c[2]; }
          else {
            const t = fy + 0.5;
            r += BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t;
            g += BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t;
            b += BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t;
          }
        }
      }
      const i = (y * size + x) * 3, n = SS * SS;
      rgb[i] = r / n; rgb[i + 1] = g / n; rgb[i + 2] = b / n;
    }
  }
  return encodePng(size, rgb);
}

const cache = new Map<string, Buffer>();
const ICONS: Record<string, { size: number; scale: number }> = {
  "/pwa-icon-192.png": { size: 192, scale: 0.34 },
  "/pwa-icon-512.png": { size: 512, scale: 0.34 },
  "/pwa-icon-maskable-512.png": { size: 512, scale: 0.29 },
  "/apple-touch-icon.png": { size: 180, scale: 0.31 },
};

export function iconPng(path: string): Buffer | null {
  const spec = ICONS[path];
  if (!spec) return null;
  let b = cache.get(path);
  if (!b) cache.set(path, (b = renderIcon(spec.size, spec.scale)));
  return b;
}

export function registerPwaRoutes(app: Express) {
  for (const path of Object.keys(ICONS)) {
    app.get(path, (_req, res) => {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(iconPng(path)!);
    });
  }
}
