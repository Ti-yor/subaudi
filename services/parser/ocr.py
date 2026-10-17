"""Subaudi local OCR worker. JSON lines on stdin/stdout; one reply per request.

The engine and open documents are kept for the life of the process, so only the
first page pays the model-load cost.
"""
import sys, json
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
import pypdfium2 as pdfium
from rapidocr_onnxruntime import RapidOCR

engine = None
docs = {}

def recognise(req):
    global engine
    if engine is None:
        engine = RapidOCR()
    path = req["path"]
    if path not in docs:
        if len(docs) > 4:
            docs.pop(next(iter(docs))).close()
        docs[path] = pdfium.PdfDocument(path)
    page = docs[path][int(req["page"])]
    image = page.render(scale=float(req.get("scale", 2.0))).to_pil()
    results, _ = engine(np.asarray(image))
    width, height = image.size
    regions = []
    for box, text, score in results or []:
        xs = [p[0] for p in box]; ys = [p[1] for p in box]
        regions.append({"text": text, "confidence": float(score),
                        "rect": [min(xs) / width, min(ys) / height, max(xs) / width, max(ys) / height]})
    return {"regions": regions, "engine": "rapidocr-onnxruntime-1.2.3"}

for line in sys.stdin:
    try:
        reply = {"result": recognise(json.loads(line))}
    except Exception as e:
        reply = {"error": str(e)}
    print(json.dumps(reply, ensure_ascii=False), flush=True)
