#!/usr/bin/env python3
"""Kleiner lokaler TTS-Dienst für Nexar Bots.

Nutzt die Python-Bibliothek `edge-tts` (Microsoft Neural-Stimmen, kein API-Key nötig).
Lauscht nur auf 127.0.0.1; die Node-App leitet Anfragen von /api/tts hierher weiter.

  GET  /health  -> {"ok": true}
  GET  /voices  -> Liste der Stimmen (de-*, en-US, en-GB, fr-FR, es-ES, it-IT)
  POST /tts     -> {"text": "...", "voice": "de-DE-KatjaNeural"}  =>  audio/mpeg
"""
import asyncio
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import edge_tts

PORT = int(os.environ.get("TTS_PORT", "8765"))
MAX_CHARS = 1500
LOCALES = ("de-", "en-US", "en-GB", "fr-FR", "es-ES", "it-IT")
VOICE_RE = re.compile(r"^[A-Za-z]{2,3}-[A-Za-z0-9]{2,4}(-[A-Za-z0-9]+)+$")
RATE_RE = re.compile(r"^[+-]\d{1,3}%$")
PITCH_RE = re.compile(r"^[+-]\d{1,3}Hz$")

_voices = {"at": 0.0, "data": None}


async def synth(text: str, voice: str, rate: str, pitch: str) -> bytes:
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    out = bytearray()
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            out += chunk["data"]
    if not out:
        raise RuntimeError("keine Audiodaten erhalten")
    return bytes(out)


def synth_retry(text: str, voice: str, rate: str, pitch: str) -> bytes:
    last = None
    for attempt in range(2):
        try:
            return asyncio.run(synth(text, voice, rate, pitch))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.4)
    raise last  # type: ignore[misc]


def load_voices():
    if _voices["data"] and time.time() - _voices["at"] < 6 * 3600:
        return _voices["data"]
    raw = asyncio.run(edge_tts.list_voices())
    data = []
    for v in raw:
        loc = v.get("Locale", "")
        if not loc.startswith(LOCALES):
            continue
        short = v["ShortName"]
        name = short.split("-", 2)[-1].replace("Neural", "")
        data.append({"id": short, "name": name, "lang": loc, "gender": v.get("Gender", "")})
    data.sort(key=lambda x: (x["lang"], x["name"]))
    _voices.update(at=time.time(), data=data)
    return data


class Handler(BaseHTTPRequestHandler):
    server_version = "NexarTTS/1.0"

    def log_message(self, fmt, *args):  # ruhig bleiben
        pass

    def _send(self, code: int, body: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True})
        if self.path == "/voices":
            try:
                return self._json(200, load_voices())
            except Exception as e:  # noqa: BLE001
                return self._json(502, {"message": f"Stimmenliste nicht abrufbar: {e}"})
        self._json(404, {"message": "nicht gefunden"})

    def do_POST(self):
        if self.path != "/tts":
            return self._json(404, {"message": "nicht gefunden"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(min(n, 20_000)) or b"{}")
        except Exception:  # noqa: BLE001
            return self._json(400, {"message": "ungültiges JSON"})
        text = str(req.get("text", "")).strip()[:MAX_CHARS]
        voice = str(req.get("voice") or "de-DE-KatjaNeural")
        rate = str(req.get("rate") or "+0%")
        pitch = str(req.get("pitch") or "+0Hz")
        if not text:
            return self._json(400, {"message": "Text fehlt"})
        if not VOICE_RE.match(voice) or not RATE_RE.match(rate) or not PITCH_RE.match(pitch):
            return self._json(400, {"message": "ungültige Stimme/Parameter"})
        try:
            audio = synth_retry(text, voice, rate, pitch)
        except Exception as e:  # noqa: BLE001
            print(f"[tts] Fehler: {e}", file=sys.stderr, flush=True)
            return self._json(502, {"message": f"Sprachsynthese fehlgeschlagen: {e}"})
        self._send(200, audio, "audio/mpeg")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    print(f"[tts] edge-tts Dienst auf 127.0.0.1:{PORT}", flush=True)
    Server(("127.0.0.1", PORT), Handler).serve_forever()
