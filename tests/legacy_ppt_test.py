import sys,struct,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services'/'parser'))
import main
from legacy_ppt import parse_streams
def rec(kind,payload=b'',instance=0,container=False):return struct.pack('<HHI',instance<<4|(15 if container else 0),kind,len(payload))+payload
class LegacyPptTests(unittest.TestCase):
    def test_current_revision_and_slide_order(self):
        text=lambda v:rec(4000,v.encode('utf-16le'))
        slide1=rec(1006,text('第一页正文'),container=True)
        slide2=rec(1006,text('第二页正文'),container=True)
        order=rec(4080,rec(1011,struct.pack('<I',3)+b'\0'*16)+text('第二页标题')+rec(1011,struct.pack('<I',2)+b'\0'*16)+text('第一页标题'),container=True)
        doc=rec(1000,order,container=True)
        data=doc+slide1+slide2
        directory=len(data)
        data+=rec(6002,struct.pack('<IIII',3<<20|1,0,len(doc),len(doc)+len(slide1)))
        edit=len(data);data+=rec(4085,struct.pack('<IIIIIII',0,0,0,directory,1,4,0))
        user=rec(4086,struct.pack('<III',0,0xE391C05F,edit))
        result=parse_streams(data,user)
        self.assertEqual(result['blocks'][0]['text'],'第二页标题')
        self.assertEqual(result['blocks'][1]['text'],'第二页正文')
        self.assertEqual(result['blocks'][2]['page'],1)
        with self.assertRaises(ValueError):parse_streams(data[:-5],user)
    def test_damaged_slide_drawing_keeps_list_text(self):
        text=lambda v:rec(4000,v.encode('utf-16le'))
        slide1=rec(1006,text('第一页正文'),container=True)
        bad=bytearray(rec(1006,text('坏页正文'),container=True)); struct.pack_into('<I',bad,12,10**6)  # inner record length overruns
        slide2=bytes(bad)
        order=rec(4080,rec(1011,struct.pack('<I',2)+b'\0'*16)+text('第一页标题')+rec(1011,struct.pack('<I',3)+b'\0'*16)+text('第二页标题'),container=True)
        doc=rec(1000,order,container=True)
        data=doc+slide1+slide2
        directory=len(data)
        data+=rec(6002,struct.pack('<IIII',3<<20|1,0,len(doc),len(doc)+len(slide1)))
        edit=len(data);data+=rec(4085,struct.pack('<IIIIIII',0,0,0,directory,1,4,0))
        user=rec(4086,struct.pack('<III',0,0xE391C05F,edit))
        result=parse_streams(data,user); texts=[b['text'] for b in result['blocks']]
        self.assertIn('第一页正文',texts); self.assertIn('第二页标题',texts); self.assertNotIn('坏页正文',texts)
        self.assertTrue(any('第 2 张' in i and '损坏' in i for i in result['issues']))
    def test_real_apache_poi_sample(self):
        sample=Path(__file__).resolve().parents[1]/'test-results'/'ppt-basic.ppt'
        if not sample.exists():self.skipTest('Download Apache POI basic_test_ppt_file.ppt to test-results/ppt-basic.ppt')
        result=main.parse(str(sample));self.assertEqual(len({b['page'] for b in result['blocks']}),2)
        self.assertEqual(result['blocks'][0]['text'],'This is a test title')
if __name__=='__main__':unittest.main()
