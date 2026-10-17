"""Subaudi Anki protocol v1. Upstream API changes belong exclusively here."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / '.tools' / 'anki-runtime'))
import json, uuid, html, re, base64, mimetypes, contextlib, tempfile, sqlite3, shutil, zipfile, time
from importlib.metadata import version
from anki.collection import Collection, ImportAnkiPackageRequest, ImportAnkiPackageOptions, ExportAnkiPackageOptions, DeckIdLimit
from anki.notes import Note
from anki.scheduler.v3 import CardAnswer

CSS = """.card {font-family:'Segoe UI','Microsoft YaHei',sans-serif;font-size:20px;line-height:1.7;text-align:left;color:#242424;background:#fff;padding:24px;max-width:760px;margin:auto} .sa-answer{border-top:1px solid #e7e7e7;margin-top:20px;padding-top:20px} .sa-source{font-size:12px;color:#888;margin-top:24px} img{max-width:100%;height:auto} .cloze{font-weight:bold}"""

class Service:
    def __init__(self, home):
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        fresh = not (self.home / 'collection.anki2').exists()
        self.col = Collection(str(self.home / 'collection.anki2'))
        if fresh:
            from anki.deck_config_pb2 import UpdateDeckConfigsRequest
            cfg = self.col.decks.get_deck_configs_for_update(1)
            self.col.decks.update_deck_configs(UpdateDeckConfigsRequest(target_deck_id=1, configs=[c.config for c in cfg.all_config], fsrs=True, limits=cfg.current_deck.limits, fsrs_health_check=True))
        self.active = None
        self.last_review = False
        self.paused_at = None

    def backup(self):
        (self.home / 'backups').mkdir(exist_ok=True)
        self.col.create_backup(backup_folder=str(self.home / 'backups'), force=True, wait_for_completion=True)

    def import_file(self, req):
        file=Path(req['path'])
        if file.stat().st_size > 512*1024*1024: raise ValueError('Anki 文件超过 512 MB 导入上限')
        if file.suffix.lower() in ('.apkg','.colpkg'):
            with zipfile.ZipFile(file) as package:
                if sum(i.file_size for i in package.infolist()) > 1024*1024*1024: raise ValueError('Anki 解压预算超限')
        def merge(package):
            self.col.import_anki_package(ImportAnkiPackageRequest(package_path=str(package),options=ImportAnkiPackageOptions(merge_notetypes=True,with_scheduling=req['scheduling'],with_deck_configs=req['scheduling'])))
        if file.suffix.lower() == '.apkg':
            merge(file); return
        if file.suffix.lower() not in ('.colpkg','.anki2'): raise ValueError('不支持的 Anki 文件')
        # Restore into an isolated scratch collection, then merge. Never replace the user's library.
        with tempfile.TemporaryDirectory(prefix='subaudi-import-') as folder:
            target=Path(folder)/'collection.anki2'
            if file.suffix.lower() == '.colpkg':
                from anki._backend import RustBackend
                RustBackend().import_collection_package(col_path=str(target),backup_path=str(file),media_folder=str(Path(folder)/'collection.media'),media_db=str(Path(folder)/'collection.media.db2'))
            else:
                deadline=time.monotonic()+8
                def progress(status, remaining, total):
                    if time.monotonic()>deadline: raise ValueError('数据库正在使用或读取超时，请关闭 Anki 后导入，或从 Anki 导出 .apkg 文件')
                with contextlib.closing(sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True,timeout=2)) as source, contextlib.closing(sqlite3.connect(target)) as dest: source.backup(dest,pages=256,progress=progress,sleep=0.05)
                media=file.with_suffix('.media')
                if media.is_dir():
                    output=Path(folder)/'collection.media'; output.mkdir()
                    size=0
                    for item in media.iterdir():
                        if item.is_file() and not item.is_symlink():
                            size+=item.stat().st_size
                            if size>1024*1024*1024: raise ValueError('媒体预算超限')
                            shutil.copy2(item,output/item.name)
            temp=Collection(str(target))
            try:
                package=Path(folder)/'merged.apkg'
                temp.export_anki_package(out_path=str(package),options=ExportAnkiPackageOptions(with_scheduling=req['scheduling'],with_deck_configs=req['scheduling'],with_media=True,legacy=False),limit=None)
            finally: temp.close()
            merge(package)

    def media(self, markup):
        media = Path(self.col.media.dir()).resolve()
        remaining = [16 * 1024 * 1024]
        def source(match):
            name = html.unescape(match[2])
            file = (media / name).resolve()
            if file.parent != media or not file.is_file(): return match[0]
            mime = mimetypes.guess_type(name)[0] or ''
            if not mime.startswith(('image/', 'audio/', 'video/')): return match[0]
            if file.stat().st_size > min(remaining[0], 8 * 1024 * 1024): return match[0]
            data = file.read_bytes(); remaining[0] -= len(data)
            return 'src="data:' + mime + ';base64,' + base64.b64encode(data).decode() + '"'
        markup = re.sub(r'\[sound:([^\]]+)\]', lambda m: '<audio controls src="' + html.escape(m[1], quote=True) + '"></audio>', markup)
        return re.sub(r'src\s*=\s*([\"\'])(.*?)\1', source, markup, flags=re.I)

    def card(self, cid):
        c = self.col.get_card(int(cid)); n = c.note()
        return dict(id=str(c.id), note=str(n.id), deck=self.col.decks.name(c.did), question=self.media(c.question()), answer=self.media(c.answer()), css=n.note_type()['css'], fields=[dict(name=k, value=v) for k,v in n.items()], tags=n.tags, suspended=c.queue == -1)

    def next(self, deck):
        self.paused_at=None
        self.col.decks.select(int(deck))
        q = self.col.sched.get_queued_cards()
        result = dict(card=None, counts=dict(new=q.new_count, learning=q.learning_count, review=q.review_count))
        self.active = None
        if q.cards:
            queued = q.cards[0]
            c = self.col.get_card(queued.card.id); c.start_timer()
            token = uuid.uuid4().hex
            self.active = (token, c, queued.states, str(deck))
            result.update(card=self.card(c.id), token=token, intervals=list(self.col.sched.describe_next_states(queued.states)))
        return result

    def model(self):
        name = 'Subaudi · 核心重点 v1'
        m = self.col.models.by_name(name)
        if m: return m
        m = self.col.models.new(name)
        for field in ['Question','Answer','Source','Identity']:
            self.col.models.add_field(m, self.col.models.new_field(field))
        t = self.col.models.new_template('核心重点')
        t['qfmt'] = '{{Question}}'
        t['afmt'] = '{{FrontSide}}<div class="sa-answer">{{Answer}}</div><div class="sa-source">{{Source}}</div>'
        self.col.models.add_template(m,t); m['css'] = CSS
        self.col.models.add(m)
        return m

    def handle(self, req):
        if req.get('protocol') != 1: raise ValueError('Anki 协议版本不匹配')
        op = req['op']
        if op == 'review-visibility':
            if self.active:
                if not req['visible'] and self.paused_at is None: self.paused_at=time.time()
                elif req['visible'] and self.paused_at is not None:
                    self.active[1].timer_started+=time.time()-self.paused_at
                    self.paused_at=None
            return True
        if op == 'status':
            cutoff=self.col.sched.day_cutoff
            reviewed=self.col.db.scalar('select count(*) from revlog where id >= ?', (cutoff-86400)*1000)
            studied=self.col.db.scalar('select count(distinct cid) from revlog where id >= ?', (cutoff-86400)*1000)
            decks=[]
            for d in self.col.decks.all_names_and_ids():
                query='did:'+str(d.id)
                decks.append(dict(id=str(d.id),name=d.name,count=len(self.col.find_cards(query)),due=len(self.col.find_cards(query+' is:due -is:suspended')),new=len(self.col.find_cards(query+' is:new')),suspended=len(self.col.find_cards(query+' is:suspended'))))
            return dict(version=version('anki'), protocol=1, total=len(self.col.find_cards('')), decks=decks,reviewed=reviewed,studied=studied,undoable=self.last_review)
        if op == 'browse':
            query=req['query']
            if req.get('deck'): query='did:'+req['deck']+' ('+query+')' if query.strip() else 'did:'+req['deck']
            ids = self.col.find_cards(query)
            rows = []
            offset=req.get('offset',0)
            for cid in ids[offset:offset+100]:
                c=self.col.get_card(cid); n=c.note()
                rows.append(dict(id=str(cid), title=html.unescape(re.sub('<[^>]+>','',n.fields[0]))[:180],deck=self.col.decks.name(c.did),suspended=c.queue == -1,reps=c.reps,interval=c.ivl))
            return dict(cards=rows,total=len(ids))
        if op == 'card': return self.card(req['cardId'])
        if op == 'next': return self.next(req['deck'])
        if op == 'answer':
            if not self.active or self.active[0] != req['token']: raise ValueError('此评分已提交或卡片已切换，请重新开始复习')
            token,c,states,deck = self.active
            rating = int(req['rating'])
            if rating not in (1,2,3,4): raise ValueError('无效评分')
            upstream_rating=(CardAnswer.AGAIN,CardAnswer.HARD,CardAnswer.GOOD,CardAnswer.EASY)[rating-1]
            self.col.sched.answer_card(self.col.sched.build_answer(card=c, states=states, rating=upstream_rating))
            self.active=None; self.last_review=True
            return self.next(deck)
        if op == 'undo':
            if not self.last_review: raise ValueError('没有可撤销的评分')
            self.col.undo(); self.active=None; self.last_review=False
            return True
        if op == 'edit':
            c=self.col.get_card(int(req['cardId'])); n=c.note()
            if len(req['fields']) != len(n.fields): raise ValueError('字段数与笔记类型不匹配')
            n.fields=req['fields']; n.tags=req['tags']; self.col.update_note(n)
            self.active=None; self.last_review=False
            return self.card(c.id)
        if op == 'suspend':
            ids=[int(req['cardId'])]
            if req['suspended']: self.col.sched.suspend_cards(ids)
            else: self.col.sched.unsuspend_cards(ids)
            self.active=None; self.last_review=False
            return True
        if op == 'import':
            self.backup()
            self.import_file(req)
            self.active=None; self.last_review=False
            return True
        if op == 'rename-deck':
            self.col.decks.rename(int(req['deck']),req['name'])
            self.active=None; self.last_review=False
            return True
        if op == 'move':
            self.col.set_deck([int(req['cardId'])],int(req['deck']))
            self.active=None; self.last_review=False
            return True
        if op == 'delete-note':
            self.backup()
            self.col.remove_notes_by_card([int(req['cardId'])])
            self.active=None; self.last_review=False
            return True
        if op == 'backup':
            self.col.export_collection_package(req['path'],True,False)
            self.col.reopen(); self.active=None; self.last_review=False
            return req['path']
        if op == 'export':
            self.col.export_anki_package(out_path=req['path'], options=ExportAnkiPackageOptions(with_scheduling=req['scheduling'],with_deck_configs=req['scheduling'],with_media=True,legacy=False),limit=DeckIdLimit(deck_id=int(req['deck'])))
            return req['path']
        if op == 'add':
            model=self.model(); did=self.col.decks.id(req['deck']); added=0
            # A note whose type the user edited down to fewer fields has no identity; skip it, don't fail.
            existing=set()
            for nid in self.col.find_notes('note:"Subaudi · 核心重点 v1"'):
                fields=self.col.get_note(nid).fields
                if len(fields)>3: existing.add(fields[3])
            from anki.collection import AddNoteRequest
            notes=[]
            for row in req['cards']:
                if row['identity'] in existing: continue
                note=Note(self.col,model)
                note.fields=[row['question'],row['answer'],row['source'],row['identity']]
                note.tags=['Subaudi','自动生成'] + (['重点'] if row.get('priority')=='core' else ['巩固']) + (['待核对'] if row.get('review') else [])
                notes.append(AddNoteRequest(note=note,deck_id=did)); existing.add(row['identity']); added+=1
            if notes: self.col.add_notes(notes)
            self.active=None; self.last_review=False
            return dict(added=added,deck=str(did))
        raise ValueError('不支持的 Anki 操作')

def main():
    sys.stdin.reconfigure(encoding='utf-8'); sys.stdout.reconfigure(encoding='utf-8')
    output=sys.stdout
    with contextlib.redirect_stdout(sys.stderr): service=Service(sys.argv[1])
    try:
        for line in sys.stdin:
            req={}
            try:
                req=json.loads(line)
                with contextlib.redirect_stdout(sys.stderr): result=service.handle(req)
                # The host matches replies FIFO and does not send an id; echo it only if present.
                response=dict(id=req.get('id'),result=result)
            except Exception as e: response=dict(id=req.get('id') if isinstance(req,dict) else None,error=str(e) or type(e).__name__)
            output.write(json.dumps(response,ensure_ascii=False)+'\n'); output.flush()
    finally:
        with contextlib.redirect_stdout(sys.stderr): service.col.close()
if __name__ == '__main__': main()
