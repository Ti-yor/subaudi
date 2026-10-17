import json, sys, zipfile, posixpath, base64, mimetypes
import xml.etree.ElementTree as E
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'.tools'/'parser-runtime'))
from legacy_ppt import parse_ppt

NS = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def relationships(z, part):
    folder, name = posixpath.split(part)
    relfile = posixpath.join(folder, '_rels', name + '.rels')
    if relfile not in z.namelist(): return {}
    result = {}
    try: rels = E.fromstring(z.read(relfile))
    except (E.ParseError, zipfile.BadZipFile, KeyError, OSError): return {}  # damaged .rels: no relationships, not a failed file
    for rel in rels:
        if rel.get('TargetMode') == 'External': continue
        target = rel.get('Target', '')
        target = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(folder, target))
        if target.startswith('../'): continue
        result[rel.get('Id')] = (target, rel.get('Type','').rsplit('/',1)[-1])
    return result

def parse(path):
    if path.lower().endswith('.ppt'): return parse_ppt(path)
    blocks = []; issues = ['Office 重排视图；不保留动画和原始浮动布局；复杂公式/图形请核对原文件']
    with zipfile.ZipFile(path) as z:
        if sum(i.file_size for i in z.infolist()) > 2*1024*1024*1024: raise ValueError('文件解压后超过 2 GB，疑似损坏')
        def asset(name):
            if Path(name).suffix.lower() not in ('.png','.jpg','.jpeg','.gif','.webp'): return None
            if name not in z.namelist() or z.getinfo(name).file_size > 24*1024*1024: return None
            try: data = z.read(name)
            except (zipfile.BadZipFile, OSError, EOFError): return None  # one damaged image is skipped
            return 'data:' + (mimetypes.guess_type(name)[0] or 'image/png') + ';base64,' + base64.b64encode(data).decode()
        if path.lower().endswith('.docx'):
            root=E.fromstring(z.read('word/document.xml'))
            for i,p in enumerate(list(root.find('w:body',NS))):
                text='\n'.join(' | '.join(''.join(t.text or '' for t in cell.findall('.//w:t',NS)) for cell in row.findall('w:tc',NS)) for row in p.findall('.//w:tr',NS)) if p.tag.endswith('tbl') else ''.join(t.text or '' for t in p.findall('.//w:t',NS))
                if text: blocks.append(dict(id=f'b{i}',text=text,kind='paragraph',locator=f'OOXML block {i+1}',issues=[]))
            for name in z.namelist():
                if '/media/' in name:
                    data=asset(name)
                    if data: blocks.append(dict(id=f'asset{len(blocks)}',text='[原文件内嵌图像：未与段落可靠对齐]',kind='image',locator=name,issues=['位置仅到资源，不保证正文顺序'],asset=data))
        else:
            presentation=E.fromstring(z.read('ppt/presentation.xml'))
            rels=relationships(z,'ppt/presentation.xml')
            slide_ids=presentation.findall('p:sldIdLst/p:sldId',NS)
            for page, slide_id in enumerate(slide_ids):
                start=len(blocks); failed=False
                # One damaged slide (dangling id, missing part, bad XML) is skipped; the rest of the deck imports.
                try:
                    rid=slide_id.get('{'+NS['r']+'}id')
                    if rid not in rels: raise ValueError('幻灯片关系缺失')
                    name=rels[rid][0]; root=E.fromstring(z.read(name)); local=relationships(z,name)
                    tree=root.find('p:cSld/p:spTree',NS)
                    shapes=list(tree) if tree is not None else []
                    def walk(items):
                        for shape in items:
                            if shape.tag == '{'+NS['p']+'}grpSp': yield from walk(list(shape))
                            else: yield shape
                    for i,shape in enumerate(walk(shapes)):
                        locator=f'第 {page+1} 张幻灯片 · 对象 {i+1}'
                        tables=shape.findall('.//a:tbl',NS)
                        if tables:
                            text='\n'.join(' | '.join(' '.join(t.text or '' for t in cell.findall('.//a:t',NS)) for cell in row.findall('a:tc',NS)) for table in tables for row in table.findall('a:tr',NS))
                        else: text='\n'.join(''.join(t.text or '' for t in p.findall('.//a:t',NS)) for p in shape.findall('.//a:p',NS))
                        if text.strip(): blocks.append(dict(id=f's{page}b{i}',text=text,kind='table' if tables else 'paragraph',page=page,locator=locator,issues=[]))
                        for j,blip in enumerate(shape.findall('.//a:blip',NS)):
                            target=local.get(blip.get('{'+NS['r']+'}embed'))
                            data=asset(target[0]) if target else None
                            if data: blocks.append(dict(id=f's{page}i{i}-{j}',text=f'[第 {page+1} 张幻灯片图像]',kind='image',page=page,locator=locator,issues=['图像内容未自动转写'],asset=data))
                        if any('chart' in el.tag for el in shape.iter()): issues.append(f'第 {page+1} 张：图表未转写，请核对原文件')
                    for target,kind in local.values():
                        if kind != 'notesSlide': continue
                        try: notes=E.fromstring(z.read(target)); lines=[]
                        except (E.ParseError, zipfile.BadZipFile, KeyError, OSError):
                            issues.append(f'第 {page+1} 张：演讲者备注无法读取，已跳过'); continue
                        for shape in notes.findall('.//p:sp',NS):
                            ph=shape.find('.//p:ph',NS)
                            if ph is not None and ph.get('type') in ('sldNum','hdr','ftr','dt','sldImg'): continue
                            lines.extend(''.join(t.text or '' for t in p.findall('.//a:t',NS)) for p in shape.findall('.//a:p',NS))
                        text='\n'.join(line for line in lines if line.strip())
                        if text: blocks.append(dict(id=f's{page}notes',text=text,kind='notes',page=page,locator=f'第 {page+1} 张幻灯片 · 演讲者备注',issues=[]))
                except (ValueError, KeyError, E.ParseError, zipfile.BadZipFile, OSError):
                    del blocks[start:]; failed=True
                    blocks.append(dict(id=f's{page}error',text='[此页无法读取]',kind='paragraph',page=page,locator=f'第 {page+1} 张幻灯片',issues=['此页已损坏，无法读取']))
                    issues.append(f'第 {page+1} 张幻灯片已损坏，无法读取，已跳过')
                if len(blocks)==start and not failed:
                    blocks.append(dict(id=f's{page}empty',text='[此页无可提取正文]',kind='paragraph',page=page,locator=f'第 {page+1} 张幻灯片',issues=['此页无可提取正文']))
                    issues.append(f'第 {page+1} 张无可提取正文')
    return {'blocks':blocks,'issues':issues}

if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8'); sys.stdout.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        req=None
        try:
            req=json.loads(line); result=parse(req['path']); print(json.dumps({'id':req.get('id'),'result':result},ensure_ascii=False),flush=True)
        except Exception as e: print(json.dumps({'id':(req or {}).get('id') if isinstance(req,dict) else None,'error':str(e)},ensure_ascii=False),flush=True)
