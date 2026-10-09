import concurrent.futures
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

spec=importlib.util.spec_from_file_location('lan_server',Path(__file__).resolve().parents[1]/'lan/server.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ServerTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.store=module.Store(self.root/'sync.json','bank')
        self.server=ThreadingHTTPServer(('127.0.0.1',0),module.make_handler(self.store,self.root))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def request(self,action,body=None,headers=None):
        defaults={'Authorization':'Bearer '+self.store.state['token']}
        if body is not None:defaults['Content-Type']='application/json'
        defaults.update(headers or {})
        request=urllib.request.Request(self.url+'/api/'+action,data=json.dumps(body).encode() if body is not None else None,headers=defaults)
        try:
            with urllib.request.urlopen(request) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,json.load(error)
    def snapshot(self,n):
        return {'data':json.dumps({'records':{'q':{'attempts':n}},'history':[],'marks':[]}),
                'progress':json.dumps({'version':1,'subjectId':'accounting','sessions':{'accounting':{'ids':['q'],'answers':{}}}})}
    def body(self,client='computer',revision=None,n=None):
        body={'clientId':client,'bankId':'bank','revision':self.store.state['revision'] if revision is None else revision}
        if n is not None:body['snapshot']=self.snapshot(n)
        return body
    def test_auth_origin_and_host(self):
        self.assertEqual(self.request('state',headers={'Authorization':'Bearer wrong'})[0],401)
        self.assertEqual(self.request('claim',self.body(n=1),{'Origin':'https://unrelated.example'})[0],403)
        self.assertEqual(self.request('state',headers={'Host':'unrelated.example'})[0],403)
        info=self.request('info')[1];self.assertNotIn('token',info);self.assertNotIn('snapshot',info)
    def test_atomic_handoff_rejects_stale_save_and_keeps_previous_file(self):
        self.assertEqual(self.request('claim',self.body(n=1))[0],200)
        old=self.body(n=9)
        self.assertEqual(self.request('claim',self.body(client='phonephone'))[0],200)
        self.assertEqual(self.request('save',old)[0],409)
        self.assertEqual(self.request('save',self.body(client='phonephone',n=2))[0],200)
        previous=json.loads((self.root/'sync.previous.json').read_text())
        self.assertEqual(previous['snapshot'],self.snapshot(1))
        self.assertEqual(self.request('state')[1]['snapshot'],self.snapshot(2))
    def test_two_writers_same_revision_only_one_commits(self):
        revision=self.store.state['revision']
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda name:self.request('claim',self.body(client=name,revision=revision,n=1))[0],['computer','phonephone']))
        self.assertEqual(sorted(results),[200,409])
    def test_restart_preserves_state_and_invalidates_old_writer(self):
        self.request('claim',self.body(n=2));old=self.body(n=3)
        fresh=module.Store(self.root/'sync.json','bank')
        self.assertEqual(fresh.state['snapshot'],self.snapshot(2));self.assertIsNone(fresh.state['writer'])
        self.assertEqual(fresh.change('save',old)[0],409)
        with self.assertRaises(ValueError):module.Store(self.root/'sync.json','different bank')
    def test_invalid_snapshot_and_bank_do_not_change_disk(self):
        old=(self.root/'sync.json').read_bytes()
        body=self.body(n=1);body['snapshot']['progress']='invalid'
        self.assertEqual(self.request('claim',body)[0],400)
        body=self.body(n=1);body['bankId']='wrong'
        self.assertEqual(self.request('claim',body)[0],422)
        self.assertEqual((self.root/'sync.json').read_bytes(),old)

if __name__=='__main__':unittest.main()
