"""Read the current persisted slide list, not obsolete incremental-save records.
MS-PPT 2.3.2–2.3.5, 2.4.14 and text atoms. Does not execute VBA or external links.
"""
import struct
import olefile

def parse_streams(data,current):
    def u32(blob,offset):
        if offset<0 or offset+4>len(blob): raise ValueError('PPT 记录被截断')
        return struct.unpack_from('<I',blob,offset)[0]
    def record(offset,limit=None):
        limit=len(data) if limit is None else limit
        if offset<0 or offset+8>limit: raise ValueError('PPT 记录头无效')
        flags,kind,length=struct.unpack_from('<HHI',data,offset)
        end=offset+8+length
        if end>limit: raise ValueError('PPT 记录长度无效')
        return flags,kind,offset+8,end
    def children(begin,end):
        while begin<end:
            r=record(begin,end);yield r;begin=r[3]
    def descendants(begin,end,depth=0):
        if depth>32: raise ValueError('PPT 嵌套过深')
        for r in children(begin,end):
            yield r
            if r[0]&15==15: yield from descendants(r[2],r[3],depth+1)
    if len(current)<20: raise ValueError('PPT Current User 无效')
    if u32(current,12)==0xF3D1C4DF: raise ValueError('加密 PPT 请先在 PowerPoint 中解密保存')
    edit=u32(current,16);visited=set();directory={};docid=None
    while edit:
        if edit in visited or len(visited)>10000: raise ValueError('PPT 编辑链无效')
        visited.add(edit);flags,kind,start,end=record(edit)
        if kind!=4085 or end-start<28: raise ValueError('PPT UserEditAtom 无效')
        if docid is None: docid=u32(data,start+16)
        previous=u32(data,start+8);persist=u32(data,start+12)
        _,typ,begin,stop=record(persist)
        if typ not in (6001,6002): raise ValueError('PPT 持久对象目录无效')
        while begin<stop:
            entry=u32(data,begin);begin+=4;first=entry&0xfffff;count=entry>>20
            if not count or begin+count*4>stop: raise ValueError('PPT 持久对象条目无效')
            for i in range(count):directory.setdefault(first+i,u32(data,begin+i*4))
            begin+=count*4
        edit=previous
    if docid not in directory: raise ValueError('PPT 缺少当前文档')
    _,kind,start,end=record(directory[docid])
    if kind!=1000: raise ValueError('PPT 文档容器无效')
    slides=[]
    def text(r):
        flags,kind,start,end=r
        if kind==4000: return data[start:end].decode('utf-16le',errors='replace').replace('\r','\n').replace('\x0b','\n').strip('\x00\n ')
        if kind==4008: return data[start:end].decode('cp1252',errors='replace').replace('\r','\n').replace('\x0b','\n').strip('\x00\n ')
        return ''
    # Everything above is container-level: without it no slide can be located, so it stays fatal.
    # Below, damage inside one slide list or one slide drawing loses only that part, with an issue.
    issues=['旧版 PPT 文本重排；图片、图表、动画与备注请核对原文件']
    damaged=0
    try:
        for flags,kind,begin,stop in children(start,end):
            if kind!=4080 or flags>>4!=0: continue
            current_slide=None
            try:
                for r in children(begin,stop):
                    if r[1]==1011:
                        ref=u32(data,r[2]); current_slide={'ref':ref,'texts':[]};slides.append(current_slide)
                    elif current_slide is not None:
                        value=text(r)
                        if value: current_slide['texts'].append(value)
            except ValueError: damaged+=1  # keep the slides read before the broken record
    except ValueError: damaged+=1
    if damaged: issues.append('部分幻灯片列表记录已损坏，其后的幻灯片可能缺失')
    blocks=[]
    for page,slide in enumerate(slides):
        texts=slide['texts'][:]
        offset=directory.get(slide['ref'])
        if offset is not None:
            try:
                _,kind,begin,stop=record(offset)
                if kind==1006:
                    for r in descendants(begin,stop):
                        value=text(r)
                        if value and value not in texts: texts.append(value)
            except ValueError:
                issues.append(f'第 {page+1} 张幻灯片的图形内容已损坏，只保留了标题与列表文字')
        if not texts: texts=['[此页无可提取正文]']
        for i,value in enumerate(texts):blocks.append(dict(id=f's{page}b{i}',text=value,kind='paragraph',page=page,locator=f'第 {page+1} 张幻灯片 · 文本 {i+1}',issues=[]))
    if not blocks: raise ValueError('未找到可读取的 PPT 幻灯片')
    return {'blocks':blocks,'issues':issues}

def parse_ppt(path):
    with olefile.OleFileIO(path) as ole:
        if ole.exists('EncryptedPackage'): raise ValueError('加密 PPT 请先解密')
        for name in ('PowerPoint Document','Current User'):
            if not ole.exists(name): raise ValueError('不是支持的 PowerPoint 97–2003 PPT 文件')
            if ole.get_size(name)>150*1024*1024: raise ValueError('PPT 内容超过解析预算')
        return parse_streams(ole.openstream('PowerPoint Document').read(),ole.openstream('Current User').read())
