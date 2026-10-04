#!/bin/zsh
cd "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  MIDI_NODE="$(command -v node)"
elif [[ -x /opt/homebrew/bin/node ]]; then
  MIDI_NODE=/opt/homebrew/bin/node
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  MIDI_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  print "Necesitas Node.js para iniciar MIDI Key."
  read
  exit 1
fi
if /usr/bin/curl -fsS http://localhost:4317/api/presets >/dev/null 2>&1; then
  /usr/bin/open -a "Google Chrome" http://localhost:4317
  exit 0
fi
(sleep 1; /usr/bin/open -a "Google Chrome" http://localhost:4317) &
"$MIDI_NODE" server.mjs
