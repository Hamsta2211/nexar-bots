#!/usr/bin/env python3
"""Jarvis voice worker: newline-delimited JSON in/out; no network service."""
import argparse, asyncio, base64, json, os, sys, tempfile
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stdin, "reconfigure"): sys.stdin.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser(); parser.add_argument('--resource-dir', default='.'); args = parser.parse_args()
MAX_PCM = 2 * 1024 * 1024

def emit(x):
    sys.stdout.write(json.dumps(x, ensure_ascii=False) + '\n'); sys.stdout.flush()

def voices():
    try:
        import edge_tts
        raw = asyncio.run(asyncio.wait_for(edge_tts.list_voices(), timeout=30))
        return [{'ShortName': x.get('ShortName'), 'Locale': x.get('Locale'), 'Gender': x.get('Gender'), 'FriendlyName': x.get('FriendlyName')} for x in raw]
    except Exception as e: raise RuntimeError(str(e))

def speak(text, voice):
    if not isinstance(text, str) or not text.strip() or len(text) > 10000: raise ValueError('text required')
    async def run():
        import edge_tts
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f: name = f.name
        try:
            await asyncio.wait_for(edge_tts.Communicate(text, voice or 'de-DE-ConradNeural').save(name), timeout=30)
            with open(name, 'rb') as audio: data = base64.b64encode(audio.read()).decode('ascii')
            return {'audio': data, 'mime': 'audio/mpeg'}
        finally:
            try: os.unlink(name)
            except OSError: pass
    return asyncio.run(run())

model = None
recognizer = None
command_recognizer = None
COMMAND_GRAMMAR = ['chat g p t', 'chat g pc', 'claude', 'cloud', 'plot', 'gemini', 'geh mini', 'jarvis', 'chat g p t abbrechen', 'chat g pc abbrechen', 'claude abbrechen', 'cloud abbrechen', 'plot abbrechen', 'gemini abbrechen', 'geh mini abbrechen', 'gehen in die abbrechen', 'jarvis abbrechen', 'jarvis nächstes lied', 'jarvis vorheriges lied', 'jarvis pause', 'jarvis abspielen', 'jarvis lauter', 'jarvis leiser', 'jarvis stumm', '[unk]']
model_path = None
def pcm(audio):
    global recognizer, command_recognizer, model, model_path
    if not isinstance(audio, str): raise ValueError('PCM16 required')
    try: raw = base64.b64decode(audio, validate=True)
    except Exception: raise ValueError('invalid PCM base64')
    if len(raw) > MAX_PCM or len(raw) % 2: raise ValueError('PCM16 required')
    import vosk
    target = os.path.join(args.resource_dir, 'models', 'vosk-model-small-de-0.15')
    if not os.path.isdir(target): raise RuntimeError('Vosk model missing: ' + target)
    if model is None or model_path != target:
        model = vosk.Model(target); model_path = target
    if recognizer is None: recognizer = vosk.KaldiRecognizer(model, 16000)
    if command_recognizer is None: command_recognizer = vosk.KaldiRecognizer(model, 16000, json.dumps(COMMAND_GRAMMAR, ensure_ascii=False))
    ok = recognizer.AcceptWaveform(raw)
    command_ok = command_recognizer.AcceptWaveform(raw)
    result = json.loads(recognizer.Result() if ok else recognizer.PartialResult())
    command = json.loads(command_recognizer.Result() if command_ok else command_recognizer.PartialResult())
    return {'text': result.get('text', result.get('partial', '')), 'partial': not ok, 'command': command.get('text', command.get('partial', '')), 'commandPartial': not command_ok}

def health():
    result = {'edgeTts': False, 'vosk': False, 'model': False, 'ready': False}
    try: import edge_tts; result['edgeTts'] = True
    except Exception: pass
    try:
        import vosk; result['vosk'] = True
        target = os.path.join(args.resource_dir, 'models', 'vosk-model-small-de-0.15')
        result['model'] = os.path.isdir(target)
    except Exception: pass
    result['ready'] = result['edgeTts'] and result['vosk'] and result['model']
    return result

def main(x):
    global recognizer, command_recognizer
    op = x.get('op')
    if op == 'health': return health()
    if op == 'voices': return voices()
    if op == 'speak': return speak(x.get('text'), x.get('voice') or 'de-DE-ConradNeural')
    if op == 'pcm': return pcm(x.get('audio', ''))
    if op == 'recognizer:reset': recognizer = None; command_recognizer = None; return {'ok': True}
    raise ValueError('unknown op')

for line in sys.stdin:
    x = None
    try:
        x = json.loads(line); emit({'id': x.get('id'), 'ok': True, 'result': main(x)})
    except Exception as e:
        emit({'id': x.get('id') if isinstance(x, dict) else None, 'ok': False, 'error': str(e)})
