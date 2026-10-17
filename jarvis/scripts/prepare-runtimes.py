#!/usr/bin/env python3
"""Build portable Linux and Windows Python runtimes for Jarvis.
Only writes resources-linux/, resources-win/, resources/models/ and this script.
"""
from __future__ import annotations
import hashlib, json, os, shutil, subprocess, sys, tarfile, tempfile, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINUX = ROOT / "resources-linux"
WIN = ROOT / "resources-win"
MODELS = ROOT / "resources" / "models"
MODEL_NAME = "vosk-model-small-de-0.15"
MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip"
PY311_URL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""): h.update(b)
    return h.hexdigest()


def download(url: str, dest: Path) -> dict:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.stat().st_size == 0:
        print("Downloading", url, flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Jarvis-runtime-builder/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
            shutil.copyfileobj(r, f, 1024 * 1024)
    return {"url": url, "sha256": sha256(dest), "bytes": dest.stat().st_size}


def run(cmd, **kw):
    print("+", " ".join(map(str, cmd)), flush=True)
    subprocess.run(cmd, check=True, **kw)


def prepare_model(manifest):
    archive = ROOT / ".runtime-downloads" / "vosk-model-small-de-0.15.zip"
    meta = download(MODEL_URL, archive)
    model = MODELS / MODEL_NAME
    if not (model / "am" / "final.mdl").exists():
        MODELS.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as z:
            z.extractall(MODELS)
    manifest["model"] = {**meta, "path": str(model.relative_to(ROOT)), "name": MODEL_NAME}


def find_linux_asset():
    # GitHub public API; no credentials or tokens are used.
    import json as _json
    api = "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
    req = urllib.request.Request(api, headers={"Accept": "application/vnd.github+json", "User-Agent": "Jarvis-runtime-builder/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r: data = _json.load(r)
    assets = [a for a in data["assets"] if a["name"].startswith("cpython-3.11.") and "x86_64-unknown-linux-gnu-install_only" in a["name"] and a["name"].endswith(".tar.gz")]
    if not assets: raise RuntimeError("No matching astral install_only Linux x86_64 asset")
    a = assets[0]
    return data.get("tag_name"), a["browser_download_url"], a["name"]


def pip_install(py: Path, target: Path, platform_args=()):
    # Standalone tarballs normally include pip; bootstrap only if needed.
    try: run([str(py), "-m", "pip", "--version"])
    except subprocess.CalledProcessError:
        run([str(py), "-m", "ensurepip", "--upgrade"])
    run([str(py), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    run([str(py), "-m", "pip", "install", "--upgrade", "--target", str(target), *platform_args, "edge-tts==7.3.1", ("vosk==0.3.41" if platform_args else "vosk==0.3.45")])


def prepare_linux(manifest):
    tag, url, name = find_linux_asset()
    archive = ROOT / ".runtime-downloads" / name
    meta = download(url, archive)
    out = LINUX / "python"
    if out.exists(): shutil.rmtree(out)
    LINUX.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as t: t.extractall(ROOT / ".runtime-extract-linux")
    candidates = list((ROOT / ".runtime-extract-linux").glob("python/install/bin/python3"))
    if not candidates:
        candidates = list((ROOT / ".runtime-extract-linux").glob("**/bin/python3"))
    if not candidates: raise RuntimeError("Linux archive has no python3")
    # python3 is .../python/bin/python3; copy that runtime root directly.
    shutil.copytree(candidates[0].parent.parent, out, symlinks=True)
    target = out / "lib" / "python3.11" / "site-packages"
    target.mkdir(parents=True, exist_ok=True)
    pip_install(out / "bin" / "python3", target)
    manifest["linux_python"] = {**meta, "release": tag, "path": str(out.relative_to(ROOT)), "python": "3.11", "asset": name}


def prepare_windows(manifest):
    archive = ROOT / ".runtime-downloads" / "python-3.11.9-embed-amd64.zip"
    meta = download(PY311_URL, archive)
    out = WIN / "python"
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    with zipfile.ZipFile(archive) as z: z.extractall(out)
    target = out / "Lib" / "site-packages"
    target.mkdir(parents=True)
    # Cross-platform binary wheels only; srt is universal and covered by these constraints.
    pip_install(Path(sys.executable), target, ("--platform", "win_amd64", "--implementation", "cp", "--python-version", "311", "--only-binary=:all:"))
    pth = out / "python311._pth"
    text = pth.read_text(encoding="utf-8") if pth.exists() else "python311.zip\n.\n"
    lines = [x for x in text.splitlines() if x.strip() not in ("import site", "Lib/site-packages")]
    lines += ["Lib/site-packages", "import site"]
    pth.write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest["windows_python"] = {**meta, "path": str(out.relative_to(ROOT)), "python": "3.11.9", "embed": "python311._pth includes Lib/site-packages and import site"}


def test_linux(manifest):
    py = LINUX / "python" / "bin" / "python3"
    model = MODELS / MODEL_NAME
    code = """import asyncio, json, struct, vosk, edge_tts
m=vosk.Model(r'''%s'''); r=vosk.KaldiRecognizer(m,16000); r.AcceptWaveform(b'\\0'*3200); print('vosk',r.FinalResult())
async def x():
 v=await edge_tts.list_voices(); assert any(a.get('Locale')=='de-DE' for a in v); print('edge_tts_voices',len(v))
asyncio.run(x())
""" % model
    run([str(py), "-c", code])
    manifest["linux_tests"] = {"imports": "pass", "vosk_silent_pcm_recognizer": "pass", "edge_tts_german_voice_list": "pass"}


def main():
    manifest = {"schema": 1, "purpose": "Jarvis standalone Python edge-tts + Vosk offline STT", "generated_utc": __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(), "provenance": {"vosk_model_source": MODEL_URL, "linux_source": "https://github.com/astral-sh/python-build-standalone/releases/latest", "windows_source": PY311_URL}}
    prepare_model(manifest); prepare_linux(manifest); prepare_windows(manifest); test_linux(manifest)
    (LINUX / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (WIN / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    shutil.rmtree(ROOT / ".runtime-extract-linux", ignore_errors=True)
    shutil.rmtree(ROOT / ".runtime-downloads", ignore_errors=True)
    print("Runtime preparation complete")

if __name__ == "__main__": main()
