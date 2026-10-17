#!/usr/bin/env python3
"""Reproducible local wake-word recognition test; optional --synthesize uses Edge TTS."""
import argparse,asyncio,json,subprocess,sys,tempfile,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'core'))
import vosk
parser=argparse.ArgumentParser();parser.add_argument('--synthesize',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
phrases=['ChatGPT','ChatGPT abbrechen','Claude','Claude abbrechen','Gemini','Gemini abbrechen','Jarvis nächstes Lied','Jarvis wie ist das Wetter in Wien']
grammar=['chat g p t','chat g pc','claude','cloud','plot','gemini','geh mini','jarvis','ja wies','chat g p t abbrechen','chat g pc abbrechen','claude abbrechen','plot abbrechen','gemini abbrechen','geh mini abbrechen','gehen in die abbrechen','jarvis nächstes lied','jarvis pause','jarvis lauter','jarvis leiser','jarvis stumm','jarvis wetter','[unk]']
async def run():
 if args.synthesize:
  import edge_tts
  for i,text in enumerate(phrases):await asyncio.wait_for(edge_tts.Communicate(text,'de-DE-ConradNeural').save(f'/tmp/jarvis-phrase-{i}.mp3'),30)
 vosk.SetLogLevel(-1);model=vosk.Model(str(root/'resources/models/vosk-model-small-de-0.15'))
 for i,text in enumerate(phrases):
  file=pathlib.Path(f'/tmp/jarvis-phrase-{i}.mp3')
  if not file.exists():continue
  pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-f','s16le','-ar','16000','-ac','1','-'])+b'\0'*32000
  free=vosk.KaldiRecognizer(model,16000);constrained=vosk.KaldiRecognizer(model,16000,json.dumps(grammar,ensure_ascii=False))
  free.AcceptWaveform(pcm);constrained.AcceptWaveform(pcm)
  print(json.dumps({'phrase':text,'free':json.loads(free.FinalResult())['text'],'command':json.loads(constrained.FinalResult())['text']},ensure_ascii=False),flush=True)
asyncio.run(run())
