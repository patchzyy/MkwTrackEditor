#!/usr/bin/env bash
# Restarts the Model Studio's dev server (port 5233 by default).
#
# Vite's file watcher does not see edits made inside a git worktree on this host, so a probe run
# after a code change has to talk to a freshly started server. This only ever stops the process
# that is listening on the given port, so it is safe to run next to other dev servers.
set -u
port="${1:-5233}"
pid=$(netstat -ano | grep "127.0.0.1:${port} " | grep LISTENING | awk '{print $5}' | head -1)
if [ -n "${pid:-}" ]; then
  powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force" >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf node_modules/.vite
nohup npx vite --host 127.0.0.1 --port "${port}" --strictPort >"/tmp/studio-vite-${port}.log" 2>&1 &
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/" || true)
  if [ "${code}" = "200" ]; then
    echo "dev server up on ${port}"
    exit 0
  fi
  sleep 1
done
echo "dev server did not come up" >&2
exit 1
