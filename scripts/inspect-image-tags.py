"""Inspect tags of current image."""
import subprocess
p = subprocess.run(['docker', 'inspect', '--format', '{{json .RepoTags}}', 'sha256:6f18f77eccaf224a0279c89d69b196e9670d6161e6e4465683f0781e9f99e195'], capture_output=True, text=True)
print(p.stdout)
