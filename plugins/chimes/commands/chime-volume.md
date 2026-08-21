---
description: Get or set the global chime volume (0-100%)
argument-hint: "[0-100]"
allowed-tools: Bash(node:*)
---

Manage the global chime volume. The setting lives in `~/.claude/chimes.json` and
applies to every Claude Code session on this machine.

Requested volume: "$ARGUMENTS"

Do exactly one of the following, then report the command's output to the user in
one short line. Do not edit `~/.claude/chimes.json` yourself — the script owns
that file, including validation, clamping and atomic writes.

- If `$ARGUMENTS` is empty, run:

  `node ${CLAUDE_PLUGIN_ROOT}/hooks/play_chime.js --get-volume`

- Otherwise run, with `$ARGUMENTS` as the value:

  `node ${CLAUDE_PLUGIN_ROOT}/hooks/play_chime.js --set-volume $ARGUMENTS`

  The script plays a preview chime at the new volume, so tell the user to listen.
  If it exits non-zero, show its error verbatim rather than retrying with a
  different value.
