import sys, tempfile, unittest, json, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services'/'anki'))
from main import Service

class AnkiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.service=Service(self.root/'main')
    def tearDown(self):
        self.service.col.close(); self.tmp.cleanup()
    def call(self, op, **kw): return self.service.handle(dict(protocol=1,op=op,**kw))
    def seed(self):
        r=self.call('add',deck='科学::测试',cards=[dict(question='为什么？',answer='因为。',source='教材 第1页',identity='one'),dict(question='第二题',answer='二',source='第2页',identity='two')])
        return r['deck']
    def test_all_four_ratings_match_revlog_and_intervals(self):
        deck=self.seed()
        for rating in (1,2,3,4):
            r=self.call('next',deck=deck);cid=int(r['card']['id'])
            self.call('answer',token=r['token'],rating=rating)
            self.assertEqual(self.service.col.db.scalar('select ease from revlog where cid=? order by id desc limit 1',cid),rating)
            self.assertEqual(self.call('status')['reviewed'],1)
            self.call('undo')
            self.assertEqual(self.call('status')['reviewed'],0)
        r=self.call('next',deck=deck)
        started=self.service.active[1].timer_started
        self.call('review-visibility',visible=False)
        self.service.paused_at-=120
        self.call('review-visibility',visible=True)
        self.assertGreater(self.service.active[1].timer_started,started+119)
    def test_manage_decks_backup_move_and_delete(self):
        deck=self.seed();self.call('rename-deck',deck=deck,name='新牌组')
        row=self.call('browse',query='',deck=deck,offset=0)['cards'][0]
        self.call('move',cardId=row['id'],deck='1')
        self.assertEqual(self.call('browse',query='',deck=deck)['total'],1)
        backup=self.root/'full.colpkg';self.call('backup',path=str(backup));self.assertTrue(backup.exists())
        self.call('delete-note',cardId=row['id'])
        self.assertEqual(self.call('status')['total'],1)
    def test_review_edit_undo_duplicate_and_persistence(self):
        deck=self.seed()
        self.assertTrue(self.service.col.decks.get_deck_configs_for_update(int(deck)).fsrs)
        self.assertEqual(self.seed(),deck)
        self.assertEqual(self.call('status')['total'],2)
        r=self.call('next',deck=deck); cid=r['card']['id']
        self.assertEqual(len(r['intervals']),4)
        self.call('answer',token=r['token'],rating=3)
        self.assertEqual(self.service.col.get_card(int(cid)).reps,1)
        with self.assertRaises(ValueError): self.call('answer',token=r['token'],rating=3)
        self.call('undo'); self.assertEqual(self.service.col.get_card(int(cid)).reps,0)
        c=self.call('card',cardId=cid); fields=[f['value'] for f in c['fields']]; fields[1]='修改后的答案'
        self.call('edit',cardId=cid,fields=fields,tags=['测试'])
        self.assertIn('修改后的答案',self.call('card',cardId=cid)['answer'])
        self.call('suspend',cardId=cid,suspended=True)
        self.assertTrue(self.call('card',cardId=cid)['suspended'])
        self.service.col.close(); self.service=Service(self.root/'main')
        self.assertTrue(self.call('card',cardId=cid)['suspended'])
        self.call('suspend',cardId=cid,suspended=False)
    def test_modern_legacy_collection_and_raw_import(self):
        deck=self.seed(); pkg=self.root/'modern.apkg'
        self.call('export',deck=deck,scheduling=True,path=str(pkg))
        other=Service(self.root/'other')
        try:
            for _ in range(2): other.handle(dict(protocol=1,op='import',path=str(pkg),scheduling=True))
            self.assertEqual(len(other.col.find_cards('')),2)
            from main import ExportAnkiPackageOptions
            legacy=self.root/'legacy.apkg'
            self.service.col.export_anki_package(out_path=str(legacy),options=ExportAnkiPackageOptions(with_media=True,legacy=True),limit=None)
            other.handle(dict(protocol=1,op='import',path=str(legacy),scheduling=False))
            self.assertEqual(len(other.col.find_cards('')),2)
            colpkg=self.root/'all.colpkg'
            self.service.col.export_collection_package(str(colpkg),True,False)
            self.service.col.reopen()
            other.handle(dict(protocol=1,op='import',path=str(colpkg),scheduling=True))
            self.assertEqual(len(other.col.find_cards('')),2)
            self.service.col.close()
            other.handle(dict(protocol=1,op='import',path=str(self.root/'main'/'collection.anki2'),scheduling=True))
            self.service=Service(self.root/'main')
            self.assertEqual(len(other.col.find_cards('')),2)
        finally: other.col.close()
    def test_cloze_and_media_roundtrip(self):
        from anki.notes import Note
        model=self.service.col.models.by_name('Cloze')
        if not model:
            from anki.stdmodels import add_cloze_model
            model=add_cloze_model(self.service.col)
        n=Note(self.service.col,model); n.fields[0]='{{c1::答案}} 和 {{c2::第二个}} <img src="test.png">'
        self.service.col.media.write_data('test.png',b'\x89PNG\r\n\x1a\n')
        self.service.col.add_note(n,1)
        ids=self.service.col.find_cards('')
        self.assertEqual(len(ids),2)
        c=self.call('card',cardId=str(ids[0]))
        self.assertIn('data:image/png;base64,',c['question']); self.assertIn('cloze',c['question'])

if __name__=='__main__': unittest.main()
