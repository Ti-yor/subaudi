import sys, unittest, tempfile, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'services'/'parser'))
from main import parse
class PptxTests(unittest.TestCase):
    def test_relationship_order_notes_tables_images_and_external(self):
        p='http://schemas.openxmlformats.org/presentationml/2006/main'; a='http://schemas.openxmlformats.org/drawingml/2006/main'; r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        relns='http://schemas.openxmlformats.org/package/2006/relationships'
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'order.pptx'
            with zipfile.ZipFile(file,'w') as z:
                z.writestr('ppt/presentation.xml',f'<p:presentation xmlns:p="{p}" xmlns:r="{r}"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>')
                z.writestr('ppt/_rels/presentation.xml.rels',f'<Relationships xmlns="{relns}"><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide9.xml"/></Relationships>')
                for number,text in [(1,'第二页'),(9,'第一页')]:
                    z.writestr(f'ppt/slides/slide{number}.xml',f'<p:sld xmlns:p="{p}" xmlns:a="{a}" xmlns:r="{r}"><p:cSld><p:spTree><p:sp><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:sp><p:pic><a:blip r:embed="img"/></p:pic><p:graphicFrame><a:tbl><a:tr><a:tc><a:p><a:t>甲</a:t></a:p></a:tc><a:tc><a:p><a:t>乙</a:t></a:p></a:tc></a:tr></a:tbl></p:graphicFrame></p:spTree></p:cSld></p:sld>')
                z.writestr('ppt/slides/_rels/slide9.xml.rels',f'<Relationships xmlns="{relns}"><Relationship Id="img" Target="../media/a.png" Type="x/image"/><Relationship Id="notes" Target="../notesSlides/notesSlide1.xml" Type="x/notesSlide"/><Relationship Id="external" Target="https://example.invalid/" TargetMode="External"/></Relationships>')
                z.writestr('ppt/notesSlides/notesSlide1.xml',f'<p:notes xmlns:p="{p}" xmlns:a="{a}"><p:sp><a:p><a:t>重点备注</a:t></a:p></p:sp></p:notes>')
                z.writestr('ppt/media/a.png',b'png-test')
            result=parse(str(file)); blocks=result['blocks']
            self.assertEqual(blocks[0]['text'],'第一页')
            self.assertTrue(any(b['kind']=='notes' and b['page']==0 and b['text']=='重点备注' for b in blocks))
            self.assertTrue(any(b['kind']=='image' and b['page']==0 for b in blocks))
            self.assertTrue(any(b['text']=='甲 | 乙' for b in blocks))
            self.assertEqual(next(b['page'] for b in blocks if b['text']=='第二页'),1)
    def test_one_damaged_slide_does_not_fail_the_deck(self):
        p='http://schemas.openxmlformats.org/presentationml/2006/main'; a='http://schemas.openxmlformats.org/drawingml/2006/main'; r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        relns='http://schemas.openxmlformats.org/package/2006/relationships'
        slide=lambda t:f'<p:sld xmlns:p="{p}" xmlns:a="{a}"><p:cSld><p:spTree><p:sp><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:sp></p:spTree></p:cSld></p:sld>'
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'damaged.pptx'
            with zipfile.ZipFile(file,'w') as z:
                # 1 good, 2 dangling id, 3 missing part, 4 malformed XML, 5 good with corrupt notes and corrupt .rels-free image
                z.writestr('ppt/presentation.xml',f'<p:presentation xmlns:p="{p}" xmlns:r="{r}"><p:sldIdLst>'+''.join(f'<p:sldId r:id="{i}"/>' for i in ('s1','gone','s3','s4','s5'))+'</p:sldIdLst></p:presentation>')
                z.writestr('ppt/_rels/presentation.xml.rels',f'<Relationships xmlns="{relns}">'+''.join(f'<Relationship Id="s{n}" Target="slides/slide{n}.xml"/>' for n in (1,3,4,5))+'</Relationships>')
                z.writestr('ppt/slides/slide1.xml',slide('第一页'))
                z.writestr('ppt/slides/slide4.xml','<p:sld <<broken')
                z.writestr('ppt/slides/slide5.xml',slide('第五页'))
                z.writestr('ppt/slides/_rels/slide5.xml.rels',f'<Relationships xmlns="{relns}"><Relationship Id="n" Target="../notesSlides/notes5.xml" Type="x/notesSlide"/></Relationships>')
                z.writestr('ppt/notesSlides/notes5.xml','not xml <')
            result=parse(str(file)); texts=[b['text'] for b in result['blocks']]
            self.assertIn('第一页',texts); self.assertIn('第五页',texts)
            self.assertEqual(sum(1 for b in result['blocks'] if b['id'].endswith('error')),3)
            self.assertEqual(sum('已损坏' in i for i in result['issues']),3)
            self.assertTrue(any('备注无法读取' in i for i in result['issues']))
            self.assertEqual(next(b['page'] for b in result['blocks'] if b['text']=='第五页'),4)  # page numbers stay aligned
    def test_real_fixture(self):
        root=Path(__file__).resolve().parents[1]
        for name in ('幻灯片示例.pptx','重排示例.docx'):
            self.assertTrue(parse(str(root/'fixtures'/name))['blocks'])
if __name__=='__main__': unittest.main()
