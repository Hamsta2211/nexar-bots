#!/usr/bin/env python3
import json, sys, time, os
for line in sys.stdin:
    try:
        x=json.loads(line); op=x.get('op')
        if op == 'crash': os._exit(23)
        time.sleep(0.35)
        result={'ready': True} if op == 'health' else {'ok': True}
        print(json.dumps({'id':x.get('id'),'ok':True,'result':result}), flush=True)
    except Exception as e:
        print(json.dumps({'id':None,'ok':False,'error':str(e)}), flush=True)
