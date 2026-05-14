# claude-chimes

A tiny Claude Code plugin that plays a unique 4-note chime when a session stops. The notes are seeded by the session ID, so every session gets its own signature melody.

- Range: **E4 (329.6 Hz) → E6 (1318.5 Hz)** — 2 octaves, 25 notes in equal temperament (A4 = 440 Hz reference: `440 · 2^(n/12)`)
- 4 distinct notes in a hash-derived order
- Cross-platform: macOS (`afplay`), Windows (`[Console]::Beep` via PowerShell), Linux (`paplay` / `aplay` / `play` / `ffplay`)

## Install

In any Claude Code session:

```text
/plugin marketplace add wozniakpl/claude-chimes
/plugin install claude-chimes@claude-chimes
```

End the session — you should hear the chime.

## Uninstall

```text
/plugin uninstall claude-chimes@claude-chimes
/plugin marketplace remove claude-chimes
```

## Requirements

- A working audio output device
- On Linux, one of `paplay`, `aplay`, `play`, or `ffplay`

## Development

Clone the repo and install dev dependencies (this also activates the pre-commit hook):

```bash
git clone https://github.com/wozniakpl/claude-chimes.git
cd claude-chimes
pnpm install
```

Then in Claude Code, point the marketplace at the local clone instead of the GitHub shortcode:

```text
/plugin marketplace add ./claude-chimes
/plugin install claude-chimes@claude-chimes
```

After editing files, refresh with:

```text
/plugin marketplace update claude-chimes
```

## License

MIT — see [LICENSE](LICENSE).
