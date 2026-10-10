import { useEffect, useId, useRef } from "react";

export type FaceLook = { kind: number; body: string; shade: string; accent: string };

// Gedämpfte, professionelle Farben (kein Neon)
export const FACE_LOOKS: FaceLook[] = [
  { kind: 0, body: "#8f969f", shade: "#727982", accent: "#2c333d" }, // Leader: Headset
  { kind: 1, body: "#4f7cac", shade: "#3f6891", accent: "#2f4f78" }, // Cap
  { kind: 2, body: "#6b9a6e", shade: "#58825b", accent: "#4c7a4f" }, // Brille + Spross
  { kind: 3, body: "#8570a8", shade: "#6f5b92", accent: "#4f4070" }, // halb geschlossene Lider
  { kind: 4, body: "#c9814a", shade: "#ae6c3b", accent: "#8d5530" }, // Beanie
  { kind: 5, body: "#b5574f", shade: "#9a4640", accent: "#3a2a2a" }, // Kopfhörer
  { kind: 6, body: "#4f9a9a", shade: "#3f8282", accent: "#7fbab6" }, // Krone
  { kind: 7, body: "#cfa94a", shade: "#b4903a", accent: "#1d222b" }, // Sonnenbrille
];

const BY_NAME: Record<string, number> = { nexar: 0, zylo: 1, kairo: 2, vexa: 3, brinx: 4, raze: 5, sera: 6, lumo: 7 };

export type FaceCfg = {
  kind?: number; skin?: string; accent?: string;
  eyes?: "round" | "wide" | "happy" | "calm" | "sleepy";
  mouth?: "smile" | "grin" | "neutral" | "open";
  brows?: "none" | "soft" | "strong" | "raised";
  blush?: boolean;
};

export function faceFor(name: string, id: number, cfg?: FaceCfg | null): FaceLook & { cfg?: FaceCfg } {
  const k = BY_NAME[name.trim().toLowerCase()];
  const base = FACE_LOOKS[k ?? Math.abs(id) % FACE_LOOKS.length];
  if (!cfg) return base;
  const kind = cfg.kind ?? base.kind;
  const preset = FACE_LOOKS[kind] || base;
  const body = cfg.skin || (cfg.kind != null ? preset.body : base.body);
  return {
    kind,
    body,
    shade: cfg.skin ? shadeOf(cfg.skin) : cfg.kind != null ? preset.shade : base.shade,
    accent: cfg.accent || (cfg.kind != null ? preset.accent : base.accent),
    cfg,
  };
}

function shadeOf(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.round(v * 0.82)).toString(16).padStart(2, "0");
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** Keyframes für Animationen (einmal pro Seite rendern). */
export function FaceStyles() {
  return (
    <style>{`
      @keyframes nexar-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
      @keyframes nexar-bar { 0%,100% { transform: scaleY(.25) } 50% { transform: scaleY(1) } }
      @keyframes nexar-ring { 0% { opacity: 0; transform: scale(.88) } 35% { opacity: .55 } 100% { opacity: 0; transform: scale(1.18) } }
      @keyframes nexar-dot { 0%,80%,100% { opacity: .25 } 40% { opacity: 1 } }
    `}</style>
  );
}

type Props = { look: FaceLook & { cfg?: FaceCfg }; speaking?: boolean; thinking?: boolean; laptop?: boolean; className?: string; title?: string };

export function AgentFace({ look, speaking = false, thinking = false, laptop = true, className, title }: Props) {
  const mouth = useRef<SVGEllipseElement>(null);
  const uid = useId().replace(/:/g, "");
  const { kind, body, shade, accent } = look;
  const cfg = look.cfg || {};
  const eyes = cfg.eyes || "round";
  const brows = cfg.brows || "strong";
  const mouthStyle = cfg.mouth || "open";
  const dark = "#1d222b";
  const px = thinking ? 5 : 0;
  const py = thinking ? -6 : 2;

  // Mundbewegung beim Sprechen (simulierte Lautstärke)
  useEffect(() => {
    const m = mouth.current;
    if (!m) return;
    if (!speaking) { m.setAttribute("ry", "0"); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const s = (t - t0) / 1000;
      const lvl = Math.max(0, 0.5 + 0.5 * Math.sin(s * 11)) * (0.55 + 0.45 * Math.sin(s * 3.3 + 1));
      m.setAttribute("ry", String(2 + lvl * 11));
      m.setAttribute("rx", String(8 + lvl * 3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speaking]);

  return (
    <svg viewBox="0 0 200 236" className={className} role="img" aria-label={title} style={{ overflow: "visible", display: "block", width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={body} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
      </defs>
      <g style={speaking ? { transformOrigin: "100px 172px", animation: "nexar-bob .8s ease-in-out infinite" } : undefined}>
        {/* Mikrofon-Arm des Headsets liegt hinter dem Gesicht */}
        <path d="M100 22 C58 22 36 54 36 96 C36 120 30 134 24 150 C20 161 29 172 43 172 L157 172 C171 172 180 161 176 150 C170 134 164 120 164 96 C164 54 142 22 100 22 Z" fill={`url(#g${uid})`} />

        {/* Augen */}
        <circle cx="74" cy="104" r={eyes === "wide" ? 21 : 18} fill="#f4f5f7" />
        <circle cx="126" cy="104" r={eyes === "wide" ? 21 : 18} fill="#f4f5f7" />
        <circle cx={74 + px} cy={104 + py} r={eyes === "wide" ? 7 : 8.5} fill={dark} />
        <circle cx={126 + px} cy={104 + py} r={eyes === "wide" ? 7 : 8.5} fill={dark} />
        {eyes === "happy" && (
          <>
            <path d="M54 106 Q74 80 94 106 Z" fill={body} />
            <path d="M106 106 Q126 80 146 106 Z" fill={body} />
          </>
        )}
        {eyes === "calm" && <path d="M54 94 H94 M106 94 H146" stroke={shade} strokeWidth="3" strokeLinecap="round" opacity=".0" />}
        {eyes === "sleepy" && (
          <>
            <path d="M54 104 A20 20 0 0 1 94 104 Z" fill={body} />
            <path d="M106 104 A20 20 0 0 1 146 104 Z" fill={body} />
          </>
        )}

        {/* Wütende Augenbrauen */}
        {kind !== 7 && brows === "strong" && (
          <>
            <polygon points="48,76 96,90 94,100 46,86" fill={dark} />
            <polygon points="152,76 104,90 106,100 154,86" fill={dark} />
          </>
        )}
        {kind !== 7 && brows === "soft" && (
          <>
            <path d="M52 84 Q74 72 96 82" fill="none" stroke={dark} strokeWidth="5" strokeLinecap="round" />
            <path d="M148 84 Q126 72 104 82" fill="none" stroke={dark} strokeWidth="5" strokeLinecap="round" />
          </>
        )}
        {kind !== 7 && brows === "raised" && (
          <>
            <path d="M52 72 Q74 60 96 70" fill="none" stroke={dark} strokeWidth="5" strokeLinecap="round" />
            <path d="M148 72 Q126 60 104 70" fill="none" stroke={dark} strokeWidth="5" strokeLinecap="round" />
          </>
        )}
        {cfg.blush && (
          <>
            <ellipse cx="58" cy="132" rx="11" ry="6" fill="#d98a84" opacity=".45" />
            <ellipse cx="142" cy="132" rx="11" ry="6" fill="#d98a84" opacity=".45" />
          </>
        )}

        {/* Mund */}
        {!speaking && mouthStyle === "smile" && <path d="M84 142 Q100 156 116 142" fill="none" stroke={dark} strokeWidth="5" strokeLinecap="round" />}
        {!speaking && mouthStyle === "grin" && <path d="M82 140 Q100 162 118 140 Z" fill={dark} />}
        {!speaking && mouthStyle === "neutral" && <path d="M88 148 H112" stroke={dark} strokeWidth="5" strokeLinecap="round" />}
        <ellipse ref={mouth} cx="100" cy="146" rx="8" ry="0" fill={dark} />

        {/* Zubehör */}
        {kind === 0 && (
          <>
            <path d="M38 100 C36 30 164 30 162 100" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" />
            <rect x="28" y="92" width="16" height="34" rx="7" fill={accent} />
            <rect x="156" y="92" width="16" height="34" rx="7" fill={accent} />
            <path d="M164 122 C164 150 142 158 122 156" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" />
            <circle cx="119" cy="156" r="5" fill={accent} />
          </>
        )}
        {kind === 1 && (
          <>
            <path d="M46 68 C50 24 150 24 154 68 Z" fill={accent} />
            <path d="M38 66 H162 Q188 66 190 82 H38 Z" fill="#2a4468" />
          </>
        )}
        {kind === 2 && (
          <>
            <circle cx="74" cy="104" r="23" fill="none" stroke={dark} strokeWidth="4" />
            <circle cx="126" cy="104" r="23" fill="none" stroke={dark} strokeWidth="4" />
            <path d="M97 102 Q100 97 103 102" fill="none" stroke={dark} strokeWidth="4" />
            <path d="M100 24 C100 10 112 6 122 10 C118 22 108 26 100 24 Z" fill={accent} />
          </>
        )}
        {kind === 3 && (
          <>
            <path d="M56 104 A18 18 0 0 1 92 104 Z" fill={body} />
            <path d="M108 104 A18 18 0 0 1 144 104 Z" fill={body} />
            <path d="M54 104 H94 M106 104 H146" stroke={dark} strokeWidth="4" strokeLinecap="round" />
          </>
        )}
        {kind === 4 && (
          <>
            <path d="M42 72 C42 24 158 24 158 72 Z" fill={accent} />
            <rect x="40" y="66" width="120" height="14" rx="6" fill="#6f4326" />
          </>
        )}
        {kind === 5 && (
          <>
            <path d="M34 104 C30 20 170 20 166 104" fill="none" stroke="#252b34" strokeWidth="8" />
            <rect x="22" y="88" width="24" height="44" rx="10" fill="#252b34" />
            <rect x="154" y="88" width="24" height="44" rx="10" fill="#252b34" />
            <rect x="26" y="94" width="10" height="32" rx="5" fill={body} opacity=".5" />
            <rect x="164" y="94" width="10" height="32" rx="5" fill={body} opacity=".5" />
          </>
        )}
        {kind === 6 && <path d="M72 36 L82 10 L94 30 L100 6 L106 30 L118 10 L128 36 Z" fill={accent} />}
        {kind === 7 && (
          <>
            <rect x="50" y="90" width="46" height="30" rx="13" fill={dark} />
            <rect x="104" y="90" width="46" height="30" rx="13" fill={dark} />
            <path d="M96 100 H104" stroke={dark} strokeWidth="4" />
            <rect x="58" y="96" width="14" height="4" rx="2" fill="#ffffff" opacity=".25" />
            <rect x="112" y="96" width="14" height="4" rx="2" fill="#ffffff" opacity=".25" />
          </>
        )}
      </g>

      {laptop && (
        <>
          <path d="M34 164 L166 164 L180 226 L20 226 Z" fill="#1c222c" stroke="#323c4a" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="100" cy="196" r="7" fill="#3c4a5e" />
          <rect x="12" y="226" width="176" height="6" rx="3" fill="#2a323e" />
        </>
      )}
    </svg>
  );
}
