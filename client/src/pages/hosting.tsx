import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/lib/ui";

const OPTIONS = [
  {
    name: "Oracle Cloud Always Free",
    tag: "Empfehlung",
    specs: "Ampere A1 (ARM): 2 OCPU + 12 GB RAM gesamt, oder 2× AMD Micro mit je 1 GB",
    pros: ["Mit Abstand am meisten Leistung", "Kein Ablaufdatum, solange das Konto besteht", "Rechenzentrum Frankfurt / Zürich wählbar"],
    cons: ["Kreditkarte zur Verifizierung nötig", "ARM-Kapazität in beliebten Regionen oft knapp", "Limits wurden 2026 von 4/24 auf 2/12 halbiert"],
    url: "https://www.oracle.com/cloud/free/",
  },
  {
    name: "Google Cloud e2-micro",
    tag: "Solide Alternative",
    specs: "1× e2-micro VM (2 geteilte vCPU, 1 GB RAM), 30 GB Disk, 1 GB Traffic/Monat",
    pros: ["Sehr zuverlässig", "Reicht für Nexar mit mehreren Bots", "Einfaches Setup"],
    cons: ["Nur US-Regionen (Oregon, Iowa, South Carolina)", "Abrechnungskonto nötig", "Wenig RAM"],
    url: "https://cloud.google.com/free",
  },
  {
    name: "Eigene Hardware",
    tag: "Volle Kontrolle",
    specs: "Raspberry Pi, alter Laptop oder NAS mit Docker",
    pros: ["Keine Cloud-Konten", "Daten bleiben zuhause"],
    cons: ["Strom kostet ein paar Euro im Monat", "Ohne Tunnel nicht von außen erreichbar"],
    url: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
  },
];

const STEPS: { title: string; body: string; code?: string }[] = [
  {
    title: "Oracle-Konto anlegen",
    body: "Registriere dich auf oracle.com/cloud/free. Wähle als Home-Region Frankfurt (eu-frankfurt-1). Die Region kann später nicht mehr geändert werden.",
  },
  {
    title: "VM erstellen",
    body: "Compute → Instances → Create. Image: Ubuntu 24.04. Shape: VM.Standard.A1.Flex mit 2 OCPU / 12 GB (oder E2.1.Micro, falls ARM ausverkauft ist). SSH-Key hinterlegen, öffentliche IP aktivieren.",
  },
  {
    title: "Port 80/443 öffnen",
    body: "In der VCN-Security-List Ingress-Regeln für TCP 80 und 443 anlegen. Dann auf der VM die Firewall öffnen:",
    code: "sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT\nsudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT\nsudo netfilter-persistent save",
  },
  {
    title: "Docker installieren",
    body: "Per SSH auf die VM verbinden und Docker installieren:",
    code: "curl -fsSL https://get.docker.com | sudo sh\nsudo usermod -aG docker $USER && newgrp docker",
  },
  {
    title: "Nexar Bots starten",
    body: "Projektordner hochladen (z.B. per git oder scp), die Datei .env mit DATABASE_URL (Supabase) und APP_SECRET daneben legen und starten. Alle Daten liegen in Supabase, der Server selbst ist austauschbar. Der Container startet nach Neustarts automatisch neu.",
    code: "cd nexar-bots\ndocker compose up -d --build\ndocker compose logs -f",
  },
  {
    title: "HTTPS mit eigener Domain (wichtig für Zugriff von überall)",
    body: "Caddy holt automatisch ein Let's-Encrypt-Zertifikat. Domain per A-Record auf die VM-IP zeigen lassen, Domain in der Caddyfile eintragen und neu starten:",
    code: "docker compose up -d",
  },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative mt-2 rounded-md border border-border bg-muted/50">
      <pre className="overflow-x-auto p-3 pr-10 font-mono text-xs leading-relaxed">{code}</pre>
      <button
        onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover-elevate"
        aria-label="Kopieren"
        data-testid="button-copy-code"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export default function Hosting() {
  return (
    <div>
      <PageHeader title="24/7 Hosting" sub="Kostenlose Cloud-Rechner, auf denen deine Bots rund um die Uhr laufen." />
      <div className="max-w-5xl space-y-8 p-6">
        <div className="grid gap-4 md:grid-cols-3">
          {OPTIONS.map((o, i) => (
            <article key={o.name} className={`flex flex-col rounded-lg border bg-card p-4 ${i === 0 ? "border-primary/50" : "border-card-border"}`} data-testid={`card-host-${i}`}>
              <span className={`w-fit rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${i === 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{o.tag}</span>
              <h2 className="mt-2 font-semibold">{o.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{o.specs}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {o.pros.map((p) => <li key={p} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />{p}</li>)}
                {o.cons.map((p) => <li key={p} className="flex gap-2 text-muted-foreground"><X className="mt-0.5 h-3.5 w-3.5 shrink-0" />{p}</li>)}
              </ul>
              <a href={o.url} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm text-primary hover:underline">
                Zum Anbieter <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </article>
          ))}
        </div>

        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Warum nicht Render, Railway oder Vercel? Deren Gratis-Pläne schlafen bei Inaktivität ein oder unterstützen keine dauerhaften Prozesse. Für Automationen, die nach Zeitplan laufen, brauchst du eine echte VM.
        </div>

        <section>
          <h2 className="text-base font-semibold">Schritt für Schritt: Oracle Cloud</h2>
          <ol className="mt-4 space-y-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-md border border-border font-mono text-xs">{i + 1}</span>
                <div>
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
                  {s.code && <CodeBlock code={s.code} />}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="rounded-lg border border-card-border bg-card p-4 text-sm">
          <h3 className="font-semibold">Tipp gegen Abschaltung</h3>
          <p className="mt-1 text-muted-foreground">
            Oracle kann Always-Free-Instanzen mit sehr geringer Auslastung zurückfordern. Ein Upgrade des Kontos auf Pay-as-you-go verhindert das, und solange du in den Free-Limits bleibst, entstehen keine Kosten. Setze dir zur Sicherheit ein Budget-Limit von 1 € mit E-Mail-Warnung.
          </p>
        </div>
      </div>
    </div>
  );
}
