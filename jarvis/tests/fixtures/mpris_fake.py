#!/usr/bin/env python3
import asyncio, json, os, signal, sys
from dbus_next.aio import MessageBus
from dbus_next.service import ServiceInterface, method
from dbus_next import BusType

class Player(ServiceInterface):
    def __init__(self, log):
        super().__init__('org.mpris.MediaPlayer2.Player')
        self.log = log
    def record(self, name):
        with open(self.log, 'a', encoding='utf-8') as f:
            f.write(name + '\n'); f.flush()
    @method()
    def Next(self): self.record('Next')
    @method()
    def Previous(self): self.record('Previous')
    @method()
    def PlayPause(self): self.record('PlayPause')
    @method()
    def Stop(self): self.record('Stop')

class Root(ServiceInterface):
    def __init__(self): super().__init__('org.mpris.MediaPlayer2')
    @method()
    def Raise(self): pass
    @method()
    def Quit(self): pass

async def main():
    log = sys.argv[1]
    bus = await MessageBus(bus_type=BusType.SESSION).connect()
    await bus.request_name('org.mpris.MediaPlayer2.jarvis_test')
    bus.export('/org/mpris/MediaPlayer2', Root())
    bus.export('/org/mpris/MediaPlayer2', Player(log))
    ready = sys.argv[2] if len(sys.argv) > 2 else ''
    if ready: open(ready, 'w').close()
    await asyncio.get_running_loop().create_future()

asyncio.run(main())
