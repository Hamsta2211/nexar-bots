// Skripte/Dateien, die Agenten auf dem PC des Nutzers anlegen, aus den Werkzeugschritten erkennen.
export type PcArtifact = {
  id: string; path: string; name: string; lang: string; content: string; bytes: number;
  via: "write" | "shell"; step: number;
};
type Step = { tool: string; args: any; result?: string };

const EXT_LANG: Record<string, string> = {
  py: "python", js: "javascript", mjs: "javascript", ts: "typescript", sh: "bash", bash: "bash", zsh: "bash",
  html: "html", htm: "html", css: "css", json: "json", md: "markdown", txt: "text", yaml: "yaml", yml: "yaml",
  toml: "toml", ini: "ini", xml: "xml", csv: "csv", sql: "sql", rb: "ruby", go: "go", rs: "rust", c: "c",
  cpp: "cpp", h: "c", java: "java", php: "php", ps1: "powershell", bat: "batch", service: "ini", conf: "ini",
  cfg: "ini", env: "text", lua: "lua", pl: "perl", svg: "xml", desktop: "ini",
};
const SKIP_PATH = /^\/(dev|proc|sys)\//;

export const langOf = (path: string) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  if (m) return EXT_LANG[m[1].toLowerCase()] || "text";
  return /(^|\/)(Dockerfile|Makefile)$/.test(path) ? "text" : "text";
};
const known = (path: string) => /\.([A-Za-z0-9]+)$/.test(path) ? !!EXT_LANG[/\.([A-Za-z0-9]+)$/.exec(path)![1].toLowerCase()] : false;

function unq(s: string) { return s.replace(/^(["'])(.*)\1$/, "$2"); }

/** Heredocs (cat > f <<'EOF' …, cat <<EOF > f, tee f <<EOF) und echo '<base64>' | base64 -d > f in Shell-Befehlen finden. */
export function filesFromCommand(cmd: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const reA = /(?:cat|tee(?:\s+-a)?)\s+(?:>>?\s*)?("[^"\n]+"|'[^'\n]+'|[^\s<>|;&"']+)\s*<<-?\s*(?:'(\w+)'|"(\w+)"|(\w+))[^\n]*\n([\s\S]*?)\n[ \t]*\2\3\4[ \t]*(?=\n|$)/g;
  const reB = /cat\s*<<-?\s*(?:'(\w+)'|"(\w+)"|(\w+))\s*>>?\s*("[^"\n]+"|'[^'\n]+'|[^\s<>|;&"']+)[^\n]*\n([\s\S]*?)\n[ \t]*\1\2\3[ \t]*(?=\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(cmd))) out.push({ path: unq(m[1]), content: m[5] });
  while ((m = reB.exec(cmd))) out.push({ path: unq(m[4]), content: m[5] });
  const reC = /(?:echo|printf\s+%s)\s+'([A-Za-z0-9+/=\s]{16,})'\s*\|\s*base64\s+-d\s*>>?\s*("[^"\n]+"|'[^'\n]+'|[^\s<>|;&"']+)/g;
  while ((m = reC.exec(cmd))) {
    try { out.push({ path: unq(m[2]), content: Buffer_from_b64(m[1].replace(/\s+/g, "")) }); } catch {}
  }
  return out;
}

function Buffer_from_b64(b64: string): string {
  const g: any = globalThis;
  if (g.Buffer) return g.Buffer.from(b64, "base64").toString("utf8");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const sizeOf = (s: string) => {
  const g: any = globalThis;
  return g.Buffer ? g.Buffer.byteLength(s, "utf8") : new TextEncoder().encode(s).length;
};

export function extractArtifacts(steps: Step[] | null | undefined): PcArtifact[] {
  const map = new Map<string, PcArtifact>();
  (steps || []).forEach((s, i) => {
    const add = (path: string, content: string, via: "write" | "shell") => {
      path = String(path || "").trim();
      if (!path || SKIP_PATH.test(path) || path.includes("$(") || path.includes("`")) return;
      if (via === "shell" && !known(path)) return;
      const name = path.split("/").filter(Boolean).pop() || path;
      map.set(path, { id: `a${i}_${map.size}`, path, name, lang: langOf(path), content, bytes: sizeOf(content), via, step: i });
    };
    if (s.tool === "write_file_on_my_pc" && s.args?.path && typeof s.args?.content === "string") {
      if (s.args.append && map.has(s.args.path)) {
        const ex = map.get(s.args.path)!;
        ex.content += s.args.content; ex.bytes = sizeOf(ex.content);
      } else add(s.args.path, s.args.content, "write");
    } else if (s.tool === "run_on_my_pc" && typeof s.args?.command === "string") {
      const failed = /^exit=(?!0)/.test(s.result || "");
      if (!failed) for (const f of filesFromCommand(s.args.command)) add(f.path, f.content, "shell");
    }
  });
  return [...map.values()];
}
