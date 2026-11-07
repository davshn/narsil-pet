#!/bin/sh
# macOS: says $NARSIL_TEXT aloud, in a Spanish voice when one is installed
# (Paulina, Mexican, first; then a Latin American one; then Mónica; then any
# other Spanish one), else the system's.
list=$(say -v '?' 2>/dev/null)
voice=$(printf '%s\n' "$list" | sed -nE 's/^(Paulina) +es_.*/\1/p' | head -n 1)
if [ -z "$voice" ]; then
  voice=$(printf '%s\n' "$list" | sed -nE 's/^(.*[^ ]) +es_(MX|CO|AR|CL|US|419)[A-Za-z0-9]* +#.*/\1/p' | head -n 1)
fi
if [ -z "$voice" ]; then
  voice=$(printf '%s\n' "$list" | sed -nE 's/^(Mónica) +es_.*/\1/p' | head -n 1)
fi
if [ -z "$voice" ]; then
  voice=$(printf '%s\n' "$list" | sed -nE 's/^(.*[^ ]) +es_[A-Za-z0-9]+ +#.*/\1/p' | head -n 1)
fi
if [ -n "$voice" ]; then
  exec say -v "$voice" "$NARSIL_TEXT"
fi
exec say "$NARSIL_TEXT"
