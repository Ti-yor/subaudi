# Builds the Python sidecars. Requires Python 3.13 with services/parser/requirements.txt installed.
# Each sidecar excludes heavy modules it never imports; see the exclude lists below.
$ErrorActionPreference = 'Stop'
$common = @('--noconfirm', '--clean', '--specpath', 'build/spec', '--workpath', 'build/pyinstaller')
$never = @('tkinter', '_tkinter', 'unittest', 'pydoc', 'test', 'matplotlib', 'scipy', 'pandas', 'IPython', 'torch', 'tensorflow')

# Office parser: stdlib + olefile only. olefile is vendored in .tools/parser-runtime (main.py adds it to
# sys.path when run as a script); a frozen build must be told explicitly, otherwise PyInstaller silently
# omits it and the parser crashes on start for every DOCX/PPTX/PPT.
$parserRuntime = '.tools/parser-runtime'
python -c "import sys; sys.path.insert(0, '$parserRuntime'); import olefile"
if ($LASTEXITCODE -ne 0) { throw "找不到 olefile：python -m pip install --target $parserRuntime olefile==0.47" }
python -m PyInstaller @common --onedir --name subaudi-parser --distpath services/parser/dist `
  --paths $parserRuntime --hidden-import olefile `
  @($never + @('numpy', 'PIL', 'cv2', 'cryptography') | ForEach-Object { '--exclude-module', $_ }) `
  services/parser/main.py
if ($LASTEXITCODE -ne 0) { throw 'Office parser build failed' }

# OCR: rapidocr + onnxruntime + headless OpenCV. Video I/O and AVIF are never used.
python -m PyInstaller @common --onedir --name subaudi-ocr --distpath services/parser/ocr-dist `
  --collect-all rapidocr_onnxruntime --collect-all pypdfium2_raw --collect-all pypdfium2 `
  @($never + @('onnxruntime.quantization', 'onnxruntime.transformers', 'onnxruntime.tools', 'cryptography') | ForEach-Object { '--exclude-module', $_ }) `
  services/parser/ocr.py
if ($LASTEXITCODE -ne 0) { throw 'OCR build failed' }
Get-ChildItem services/parser/ocr-dist -Recurse -Include 'opencv_videoio_ffmpeg*.dll', '_avif*.pyd' | Remove-Item -Force

Remove-Item -Recurse -Force build/pyinstaller, build/spec -ErrorAction SilentlyContinue
