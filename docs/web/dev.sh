#!/usr/bin/env bash
# Launch the Plain Charts docs dev server.  Run:  ./dev.sh
export PATH="$HOME/opt/node/bin:$PATH"
cd "$(dirname "$0")"
exec npm run dev
