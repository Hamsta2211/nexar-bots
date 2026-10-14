import { API_BASE, authHeaders } from "./queryClient";
import { wavFromInt16 } from "./audio-utils";

/** Sendet ein fertig aufgenommenes Segment zur deutschen Whisper-Transkription über den Render-Server. */
export async function transcribe(pcm: Int16Array, hint: string): Promise<string> {
  const wav = wavFromInt16(pcm);
  const res = await fetch(`${API_BASE}/api/stt?lang=de&hint=${encodeURIComponent(hint)}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav", ...authHeaders() },
    credentials: "same-origin",
    body: new Blob([wav.buffer as ArrayBuffer]),
  });
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).message || message; } catch {}
    throw new Error(message);
  }
  return String((await res.json()).text || "");
}
