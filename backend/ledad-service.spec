# Reproducible one-directory bundle: no Python installation needed on the target Mac.
from pathlib import Path

root = Path(SPECPATH)
a = Analysis(
    [str(root / 'entrypoint.py')],
    pathex=[str(root)],
    datas=[(str(root / 'ledad/ai/prompts'), 'ledad/ai/prompts'),
           (str(root / 'ledad/meeting/pricing.json'), 'ledad/meeting')],
    hiddenimports=[],
    excludes=['tkinter', 'pytest'],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='ledad-service', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='ledad-service')
