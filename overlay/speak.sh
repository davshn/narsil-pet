#!/bin/sh
# macOS: says $NARSIL_TEXT aloud, in a Spanish voice when one is installed
# (Paulina, Mexican, first; then a Latin American one; then Mónica; then any
# other Spanish one), else the system's.
# With NARSIL_FOLLOW=1 (the answer to a message sent by voice) it tells the hub
# at NARSIL_PORT, with NARSIL_TOKEN, once it has finished speaking: the hub then
# opens Claude's dictation for your answer.
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
  say -v "$voice" "$NARSIL_TEXT"
else
  say "$NARSIL_TEXT"
fi

if [ "$NARSIL_FOLLOW" = "1" ] && [ -n "$NARSIL_PORT" ] && [ -n "$NARSIL_TOKEN" ]; then
  curl -s -m 3 -o /dev/null -X POST -H "x-narsil-token: $NARSIL_TOKEN" "http://127.0.0.1:$NARSIL_PORT/ear/follow" || true
fi
