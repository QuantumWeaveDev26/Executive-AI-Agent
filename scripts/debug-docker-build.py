from pathlib import Path
import subprocess

stage = Path('/opt/thaara-v2-pilot/staging-phone-n8n-sync')
if stage.exists():
    p = subprocess.run([
        'docker', 'build', '--no-cache', '--network=none',
        '--build-arg', 'BASE_IMAGE=thaara-v2-base:phone-n8n-sync-r2-base',
        '-t', 'test-build',
        '-f', str(stage / 'Dockerfile'),
        str(stage)
    ], capture_output=True, text=True)
    print("Return code:", p.returncode)
    print("STDOUT:\n", p.stdout[-1500:])
    print("STDERR:\n", p.stderr[-1500:])
