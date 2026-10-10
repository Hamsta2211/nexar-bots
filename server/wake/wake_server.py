#!/usr/bin/env python3
"""Lokaler Hotword-Dienst für Nexar Bots (openWakeWord-Merkmale + eigene Klassifikatoren).

openWakeWord liefert das Audio-Frontend (Mel-Spektrogramm + Google-Speech-Embedding, 96 Werte je 80 ms).
Für jeden Agenten wird aus wenigen Aufnahmen des Namens ein kleines logistisches Modell trainiert
(es gibt kein vortrainiertes "Nexar"). Läuft nur auf 127.0.0.1; Node leitet /api/wake/* hierher.

  GET  /health                 -> {"ok":true,"ready":bool,"models":[ids]}
  PUT  /models   (JSON)        -> {"agentId": {"w":[..1536],"b":x,"mu":[..],"sd":[..],"thr":0.8}, ...}
  POST /score?sid=…  (int16 LE, 16 kHz, mono)  -> {"scores":{id:p},"hits":[id],"frames":n}
  POST /reset?sid=…
  POST /train    (JSON)        -> {"agent","pos":[b64 int16 clips],"neg":[b64 int16 clips],
                                   "otherPos":[[1536]..], "oldNeg":[[1536]..]}
                                   => {"model":{…},"posWin":[[1536]..],"negWin":[[1536]..],"stats":{…}}
"""
import base64
import importlib.util
import json
import os
import sys
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np

PORT = int(os.environ.get("WAKE_PORT", "8766"))
MODEL_DIR = os.environ.get("WAKE_MODEL_DIR", "/opt/wake/models")
OWW_DIR = os.environ.get("WAKE_OWW_DIR", "")  # Ordner mit utils.py (für lokale Tests)
IDLE_UNLOAD_S = int(os.environ.get("WAKE_IDLE_UNLOAD", "240"))
WIN = 16          # Fenster in Embedding-Frames (≈1,28 s)
DIM = 96
BLOCK = 1280      # 80 ms @ 16 kHz
MAX_SESSIONS = 2
CONSEC = 2        # so viele aufeinanderfolgende Frames über Schwelle
COOLDOWN_S = 2.0

_lock = threading.RLock()
_feat_cls = None
_models: dict = {}
_sessions: dict = {}
_last_use = time.time()


# ---------------------------------------------------------------- Frontend laden
def _load_audio_features():
    """AudioFeatures aus openwakeword/utils.py laden, ohne das ganze Paket (sklearn, tflite …) zu importieren."""
    global _feat_cls
    if _feat_cls:
        return _feat_cls
    stub = types.ModuleType("openwakeword")
    stub.FEATURE_MODELS, stub.VAD_MODELS, stub.MODELS = {}, {}, {}
    sys.modules.setdefault("openwakeword", stub)
    path = None
    if OWW_DIR and os.path.exists(os.path.join(OWW_DIR, "utils.py")):
        path = os.path.join(OWW_DIR, "utils.py")
    else:
        from importlib.metadata import distribution
        path = str(distribution("openwakeword").locate_file("openwakeword/utils.py"))
    spec = importlib.util.spec_from_file_location("oww_utils", path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    _feat_cls = mod.AudioFeatures
    return _feat_cls


def new_features():
    cls = _load_audio_features()
    return cls(
        melspec_model_path=os.path.join(MODEL_DIR, "melspectrogram.onnx"),
        embedding_model_path=os.path.join(MODEL_DIR, "embedding_model.onnx"),
        inference_framework="onnx",
        ncpu=1,
    )


_clip_feat = None


def clip_features():
    global _clip_feat
    if _clip_feat is None:
        _clip_feat = new_features()
    return _clip_feat


def unload_if_idle():
    global _clip_feat
    while True:
        time.sleep(30)
        with _lock:
            if not any(j.get('state') == 'running' for j in _jobs.values()) and time.time() - _last_use > IDLE_UNLOAD_S and (_clip_feat is not None or _sessions):
                _sessions.clear()
                _clip_feat = None
                import gc
                gc.collect()
                print("[wake] idle – Modelle entladen", flush=True)


# ---------------------------------------------------------------- Embeddings & Training
def pcm_from_b64(s: str) -> np.ndarray:
    b = base64.b64decode(s)
    return np.frombuffer(b[: len(b) // 2 * 2], dtype="<i2").astype(np.int16)


def embed(x: np.ndarray) -> np.ndarray:
    """int16-Clip -> (frames, 96) über denselben Streaming-Pfad wie bei der Erkennung (gleiche Zahlenwerte)."""
    x = np.asarray(x, dtype=np.int16)
    MIN = 16000 * 3  # vorne mit Raumrauschen auffüllen wie im Dauerstream
    if len(x) < MIN:
        floor = float(np.std(x[:1600])) if len(x) >= 1600 else 50.0
        pad = np.random.default_rng(3).normal(0, max(floor, 5.0), MIN - len(x))
        x = np.concatenate([pad.astype(np.int16), x])
    f = clip_features()
    f.reset()
    out = []
    for i in range(len(x) // BLOCK):
        before = f.feature_buffer.shape[0]
        f(x[i * BLOCK:(i + 1) * BLOCK])
        if f.feature_buffer.shape[0] > before or (f.feature_buffer.shape[0] == before and before >= f.feature_buffer_max_len):
            out.append(np.array(f.feature_buffer[-1], dtype=np.float32))
    return np.asarray(out, dtype=np.float32).reshape(-1, DIM)


def windows(emb: np.ndarray, ends=None, stride=1):
    """(frames,96) -> Fenster (n,1536); ends = erlaubte Endframes (exklusiv)."""
    n = emb.shape[0]
    out = []
    rng = ends if ends is not None else range(WIN, n + 1, stride)
    for end in rng:
        if end - WIN < 0 or end > n:
            continue
        out.append(emb[end - WIN:end].reshape(-1))
    return np.asarray(out, dtype=np.float32).reshape(-1, WIN * DIM)


def augment(x: np.ndarray, rng: np.random.Generator):
    f = x.astype(np.float32)
    yield x
    yield np.clip(f * 1.6, -32768, 32767).astype(np.int16)
    sd = max(30.0, float(np.std(f)) * 0.15)
    yield np.clip(f + rng.normal(0, sd, f.shape), -32768, 32767).astype(np.int16)


def synth_negatives(rng: np.random.Generator):
    for lvl in (0, 4, 40, 300, 1500):
        yield (rng.normal(0, lvl, 32000)).astype(np.int16)
    # grob sprachähnliches Rauschen (amplitudenmoduliert)
    t = np.arange(32000) / 16000.0
    for f0 in (110, 220):
        env = (np.sin(2 * np.pi * 3 * t) > 0).astype(np.float32)
        yield (env * 3000 * np.sin(2 * np.pi * f0 * t) + rng.normal(0, 200, 32000)).astype(np.int16)


def fit_logistic(X: np.ndarray, y: np.ndarray, l2=0.02, iters=500, lr=0.3):
    mu = X.mean(0)
    sd = X.std(0) + 1e-3
    Z = (X - mu) / sd
    n, d = Z.shape
    wpos = 0.5 / max(1, int(y.sum()))
    wneg = 0.5 / max(1, int((1 - y).sum()))
    sw = np.where(y > 0.5, wpos, wneg).astype(np.float32)
    sw = sw / sw.sum()
    w = np.zeros(d, dtype=np.float32)
    b = 0.0
    m = np.zeros(d, dtype=np.float32)
    v = np.zeros(d, dtype=np.float32)
    mb = vb = 0.0
    for t in range(1, iters + 1):  # Adam
        p = 1.0 / (1.0 + np.exp(-np.clip(Z @ w + b, -30, 30)))
        e = (p - y) * sw
        g = Z.T @ e + l2 * w / d * 50
        gb = float(e.sum())
        m = 0.9 * m + 0.1 * g
        v = 0.999 * v + 0.001 * g * g
        mb = 0.9 * mb + 0.1 * gb
        vb = 0.999 * vb + 0.001 * gb * gb
        mh, vh = m / (1 - 0.9 ** t), v / (1 - 0.999 ** t)
        w -= lr * mh / (np.sqrt(vh) + 1e-8)
        b -= lr * (mb / (1 - 0.9 ** t)) / (np.sqrt(vb / (1 - 0.999 ** t)) + 1e-8)
    return w, b, mu, sd


def score_windows(model: dict, X: np.ndarray) -> np.ndarray:
    z = (X - model["mu_a"]) / model["sd_a"]
    s = z @ model["w_a"] + model["b"]
    return 1.0 / (1.0 + np.exp(-np.clip(s, -30, 30)))


def prep_model(m: dict) -> dict:
    m = dict(m)
    m["w_a"] = np.asarray(m["w"], dtype=np.float32)
    m["mu_a"] = np.asarray(m["mu"], dtype=np.float32)
    m["sd_a"] = np.asarray(m["sd"], dtype=np.float32)
    m["b"] = float(m["b"])
    m["thr"] = float(m.get("thr", 0.8))
    return m


def train(req: dict) -> dict:
    rng = np.random.default_rng(7)
    pos_clips = [pcm_from_b64(s) for s in req.get("pos", [])]
    neg_clips = [pcm_from_b64(s) for s in req.get("neg", [])]
    if len(pos_clips) < 3:
        raise ValueError("Mindestens 3 Aufnahmen des Namens nötig")
    pos_w, neg_w, own_pos = [], [], []
    for clip in pos_clips:
        for variant in augment(clip, rng):
            em = embed(variant)
            n = em.shape[0]
            # Das Wort endet ~3 Frames vor dem Clip-Ende (Client hängt ~240 ms Stille an).
            good = [e for e in range(n - 4, n + 1) if e >= WIN]
            if not good:
                good = [n]
            pw = windows(em, ends=good)
            pos_w.append(pw)
            if variant is clip:
                own_pos.append(pw)
            # Alles, was deutlich früher endet (halbes Wort) ist negativ
            early = [e for e in range(WIN, max(WIN, n - 9))]
            if early:
                neg_w.append(windows(em, ends=early, stride=1)[::2])
    for clip in neg_clips:
        em = embed(clip)
        neg_w.append(windows(em, stride=2))
    for clip in synth_negatives(rng):
        neg_w.append(windows(embed(clip), stride=3))
    if req.get("otherPos"):
        neg_w.append(np.asarray(req["otherPos"], dtype=np.float32).reshape(-1, WIN * DIM))
    if req.get("oldNeg"):
        neg_w.append(np.asarray(req["oldNeg"], dtype=np.float32).reshape(-1, WIN * DIM))
    P = np.concatenate(pos_w, 0)
    N = np.concatenate([a for a in neg_w if len(a)], 0)
    X = np.concatenate([P, N], 0)
    y = np.concatenate([np.ones(len(P)), np.zeros(len(N))]).astype(np.float32)
    w, b, mu, sd = fit_logistic(X, y)
    model = {"w": w.round(4).tolist(), "b": round(float(b), 4), "mu": mu.round(4).tolist(),
             "sd": sd.round(4).tolist(), "thr": 0.8}
    pm = prep_model(model)
    sp, sn = score_windows(pm, P), score_windows(pm, N)
    # Schwelle: deutlich über den lautesten Negativen, aber unter den meisten Positiven
    thr = float(np.clip(max(0.7, np.quantile(sn, 0.999) + 0.05 if len(sn) else 0.7), 0.7, 0.97))
    model["thr"] = round(thr, 3)
    stats = {"pos": int(len(P)), "neg": int(len(N)), "posMean": round(float(sp.mean()), 3),
             "negMax": round(float(sn.max()), 3), "thr": model["thr"],
             "recall": round(float((sp >= thr).mean()), 3)}
    # Kompakte Trainingsfenster zum späteren Wiederverwenden (nur unaugmentierte Originale / ausgewählte Negative)
    own = np.concatenate(own_pos, 0)
    keep_neg = np.concatenate([windows(embed(c), stride=4) for c in neg_clips], 0) if neg_clips else np.zeros((0, WIN * DIM), np.float32)
    if len(keep_neg) > 40:
        keep_neg = keep_neg[np.linspace(0, len(keep_neg) - 1, 40).astype(int)]
    return {"model": model, "posWin": own.round(2).tolist(), "negWin": keep_neg.round(2).tolist(), "stats": stats}


# ---------------------------------------------------------------- Streaming-Erkennung
class Sess:
    def __init__(self):
        self.f = new_features()
        self.rest = np.zeros(0, dtype=np.int16)
        self.frames = 0
        self.consec: dict = {}
        self.cool: dict = {}
        self.at = time.time()


def get_sess(sid: str) -> Sess:
    s = _sessions.get(sid)
    if s is None:
        if len(_sessions) >= MAX_SESSIONS:
            oldest = min(_sessions, key=lambda k: _sessions[k].at)
            _sessions.pop(oldest, None)
        s = Sess()
        _sessions[sid] = s
    s.at = time.time()
    return s


def score(sid: str, pcm: np.ndarray):
    s = get_sess(sid)
    x = np.concatenate([s.rest, pcm]) if len(s.rest) else pcm
    scores: dict = {}
    hits = []
    now = time.time()
    n_blocks = len(x) // BLOCK
    for i in range(n_blocks):
        s.f(x[i * BLOCK:(i + 1) * BLOCK])
        s.frames += 1
        if s.frames < WIN + 2 or not _models:
            continue
        feat = s.f.get_features(WIN)[0].reshape(1, -1)
        for aid, m in _models.items():
            p = float(score_windows(m, feat)[0])
            scores[aid] = max(p, scores.get(aid, 0.0))
            if p >= m["thr"]:
                s.consec[aid] = s.consec.get(aid, 0) + 1
            else:
                s.consec[aid] = 0
            if s.consec.get(aid, 0) >= CONSEC and now >= s.cool.get(aid, 0) and aid not in hits:
                hits.append(aid)
                s.cool[aid] = now + COOLDOWN_S
                s.consec[aid] = 0
    s.rest = x[n_blocks * BLOCK:]
    if hits:  # nur der stärkste Treffer zählt
        hits.sort(key=lambda a: -scores.get(a, 0))
        hits = hits[:1]
    return {"scores": {k: round(v, 3) for k, v in scores.items()}, "hits": hits, "frames": s.frames}


# ---------------------------------------------------------------- HTTP
_jobs: dict = {}


def run_job(aid: str, req: dict):
    try:
        res = train(req)
        _jobs[aid] = {"state": "done", **res}
    except Exception as e:  # noqa: BLE001
        print("[wake] Training-Fehler:", repr(e), flush=True)
        _jobs[aid] = {"state": "error", "error": str(e)}


class H(BaseHTTPRequestHandler):
    server_version = "nexar-wake/1"

    def log_message(self, *a):  # ruhig
        pass

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 30_000_000:
            raise ValueError("zu groß")
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/train/status":
            aid = (parse_qs(u.query).get("agent") or ["x"])[0]
            j = _jobs.get(aid)
            if not j:
                return self._send(404, {"error": "kein Training"})
            if j["state"] == "done":  # Ergebnis einmal ausliefern
                _jobs.pop(aid, None)
            return self._send(200, j)
        if u.path == "/health":
            return self._send(200, {"ok": True, "ready": os.path.exists(os.path.join(MODEL_DIR, "embedding_model.onnx")),
                                    "models": list(_models.keys())})
        self._send(404, {"error": "not found"})

    def do_PUT(self):
        global _last_use
        try:
            if urlparse(self.path).path == "/models":
                data = json.loads(self._body() or b"{}")
                with _lock:
                    _models.clear()
                    for k, v in data.items():
                        _models[k] = prep_model(v)
                    _sessions.clear()
                return self._send(200, {"ok": True, "models": list(_models.keys())})
            self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            self._send(400, {"error": str(e)})

    def do_POST(self):
        global _last_use
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            body = self._body()
            with _lock:
                _last_use = time.time()
                if u.path == "/score":
                    pcm = np.frombuffer(body[: len(body) // 2 * 2], dtype="<i2").astype(np.int16)
                    return self._send(200, score((q.get("sid") or ["x"])[0], pcm))
                if u.path == "/reset":
                    _sessions.pop((q.get("sid") or ["x"])[0], None)
                    return self._send(200, {"ok": True})
                if u.path == "/train":
                    req = json.loads(body)
                    aid = str(req.get("agent") or "x")
                    job = _jobs.get(aid)
                    if job and job["state"] == "running":
                        return self._send(409, {"error": "Training läuft bereits"})
                    _jobs[aid] = {"state": "running", "at": time.time()}
                    threading.Thread(target=run_job, args=(aid, req), daemon=True).start()
                    return self._send(202, {"state": "running"})
            self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            print("[wake] Fehler:", repr(e), flush=True)
            self._send(400, {"error": str(e)})


if __name__ == "__main__":
    threading.Thread(target=unload_if_idle, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print(f"[wake] läuft auf 127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
