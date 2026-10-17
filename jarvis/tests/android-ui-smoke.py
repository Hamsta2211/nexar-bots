#!/usr/bin/env python3
"""Run against the dedicated local test emulator, never a user's phone."""
import os,re,subprocess,time,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ADB=os.environ.get('ANDROID_TEST_ADB','/workspace/.android-sdk-nexar/platform-tools/adb')
SERIAL='emulator-5586'
OUT=Path('/workspace/jarvis-evidence');OUT.mkdir(exist_ok=True)
def adb(*args,timeout=45,binary=False):
    r=subprocess.run([ADB,'-s',SERIAL,*args],capture_output=True,timeout=timeout)
    if r.returncode:raise RuntimeError(r.stderr.decode(errors='replace'))
    return r.stdout if binary else r.stdout.decode(errors='replace').strip()
def tree():
    adb('shell','uiautomator','dump','/sdcard/jarvis-test.xml',timeout=60)
    return ET.fromstring(adb('exec-out','cat','/sdcard/jarvis-test.xml'))
def texts():return [n.get('text','') for n in tree().iter('node') if n.get('text')]
def tap(label):
    for attempt in range(2):
        for n in tree().iter('node'):
            if n.get('text')==label:
                a=list(map(int,re.findall(r'\d+',n.get('bounds',''))))
                if len(a)==4 and a[2]>a[0] and a[3]>a[1]:
                    adb('shell','input','tap',str((a[0]+a[2])//2),str((a[1]+a[3])//2));time.sleep(1);return
        adb('shell','input','swipe','540','1500','540','650','350');time.sleep(1)
    raise AssertionError('Bedienelement fehlt: '+label)
try:
    start=time.monotonic();last=0
    while time.monotonic()-start<600:
        try:
            if adb('shell','getprop','sys.boot_completed',timeout=6)=='1':break
        except Exception:pass
        if time.monotonic()-last>30:print('Warte auf Android-Teststart …',flush=True);last=time.monotonic()
        time.sleep(5)
    else:raise TimeoutError('Android-Boot blieb aus')
    adb('shell','input','keyevent','224');adb('shell','wm','dismiss-keyguard')
    adb('shell','settings','put','system','screen_off_timeout','600000')
    print(adb('install','-r',str(ROOT/'release/Jarvis-0.3.0-android.apk'),timeout=120),flush=True)
    adb('shell','am','start','-W','-n','im.nexar.jarvis/.MainActivity',timeout=90)
    time.sleep(4)
    assert adb('shell','pidof','im.nexar.jarvis'),'App-Prozess fehlt'
    values=texts();assert all(x in values for x in ['Jarvis','ChatGPT','Claude','Gemini','Medien','Mikrofon']),values
    assert not any('GitHub' in x for x in values),'GitHub-Anmeldung verblieben'
    for _ in range(10):
        values=texts()
        if any('Wetter ·' in x or 'Wetter nicht verfügbar' in x for x in values):break
        time.sleep(3)
    weather=[x for x in values if 'Wetter' in x]
    print('ANDROID_WEATHER_RUNTIME',weather,flush=True)
    (OUT/'android-home.png').write_bytes(adb('exec-out','screencap','-p',binary=True))
    tap('Einstellungen');values=texts();assert 'Conrad' in values,values
    assert not any('ShortName' in x for x in values),values
    adb('shell','input','keyevent','4');time.sleep(1)
    tap('Konto');values=texts();assert 'Anmelden' in values and 'Registrieren' in values,values
    adb('shell','input','keyevent','4');time.sleep(1)
    adb('shell','pm','grant','im.nexar.jarvis','android.permission.RECORD_AUDIO')
    tap('Mikrofon');time.sleep(2)
    assert adb('shell','pidof','im.nexar.jarvis'),'Mikrofonaktion hat App beendet'
    print('ANDROID_MIC_RUNTIME',texts(),flush=True)
    print('ANDROID_UI_SMOKE_PASS: reale APK installiert/gestartet, Konto, Conrad-Einstellung, Mikrofonaktion ohne Absturz; kein physisches Audio und keine angemeldeten Anbieter getestet',flush=True)
finally:
    Path('/tmp/jarvis-emulator-tests-done').touch()
