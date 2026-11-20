import os
import subprocess
import sys

errors = 0
for root, dirs, files in os.walk('.'):
    if any(k in root for k in ['.venv', 'node_modules', '__pycache__', '.git', 'checkpoint']):
        continue
    for f in files:
        full = os.path.join(root, f)
        if f.endswith('.js') or f.endswith('.mjs'):
            res = subprocess.run(['node', '--check', full], capture_output=True, text=True)
            if res.returncode != 0:
                print(f'JS Syntax Error in {full}:\n{res.stderr}')
                errors += 1
        elif f.endswith('.py'):
            res = subprocess.run([sys.executable, '-m', 'py_compile', full], capture_output=True, text=True)
            if res.returncode != 0:
                print(f'Py Syntax Error in {full}:\n{res.stderr}')
                errors += 1

if errors == 0:
    print('VERIFIED: 100% OF JS/MJS/PY SOURCE FILES ARE SYNTACTICALLY VALID.')
else:
    print(f'FAILED: {errors} syntax errors found.')
sys.exit(errors)

