"""Build the isolated Anki worker with the pinned project-local runtime."""
import os, shutil, subprocess, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
runtime = root / ".tools" / "anki-runtime"
os.environ["PYTHONPATH"] = str(runtime)
os.environ["PYINSTALLER_CONFIG_DIR"] = str(root / ".tools" / "pyinstaller-cache")
# Anki's Python layer never imports these; PyInstaller would otherwise sweep them in from the
# global interpreter (numpy + Pillow + cryptography alone were ~50 MB of the old 107 MB worker).
never = ["numpy", "PIL", "cryptography", "tkinter", "_tkinter", "unittest", "pydoc", "matplotlib", "scipy", "IPython"]
work = root / "build" / "pyinstaller-anki"
subprocess.run(
    [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--name", "subaudi-anki",
     "--paths", str(runtime), "--collect-all", "anki", "--copy-metadata", "anki",
     *[a for m in never for a in ("--exclude-module", m)],
     "--distpath", str(root / "services" / "anki" / "dist"), "--workpath", str(work),
     "--specpath", str(work), str(root / "services" / "anki" / "main.py")],
    check=True, cwd=root)
shutil.rmtree(work, ignore_errors=True)
