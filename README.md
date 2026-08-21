# claude-chimes

A tiny Claude Code plugin that plays a unique 4-note chime when a session stops. The notes are seeded by the session ID, so every session gets its own signature melody.

- Range: **E4 (329.6 Hz) → E6 (1318.5 Hz)** — 2 octaves, 25 notes in equal temperament (A4 = 440 Hz reference: `440 · 2^(n/12)`)
- 4 distinct notes in a hash-derived order
- Cross-platform: macOS (`afplay`), Windows (`System.Media.SoundPlayer` via PowerShell), Linux (`paplay` / `aplay` / `play` / `ffplay`)
- Global volume setting, so the chime can be quiet while everything else stays loud

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

## Volume

The chime volume is a global percentage (`0`–`100`), shared by every session and every project on the machine. It defaults to `100`, which is the original chime.

From inside Claude Code:

```text
/chime-volume 20     # set to 20%, plays a preview
/chime-volume        # report the current volume and where it came from
```

Or directly:

```bash
node <plugin>/hooks/play_chime.js --set-volume 20
node <plugin>/hooks/play_chime.js --get-volume
node <plugin>/hooks/play_chime.js --play        # preview at the current volume
```

The value is stored in `~/.claude/chimes.json` (honouring `CLAUDE_CONFIG_DIR`), and unrelated keys in that file are preserved:

```json
{
  "version": 1,
  "volume": 20
}
```

`CLAUDE_CHIMES_VOLUME` overrides the file for a single shell:

```bash
CLAUDE_CHIMES_VOLUME=0 claude
```

Notes:

- The percentage maps to amplitude through `(volume / 100) ^ 1.5`, so the number roughly tracks perceived loudness. Linear amplitude would make `50%` sound almost unchanged; a mixer-style log fader would make `20%` inaudible.
- `0` is a hard mute — no audio file is written and no player process is started.
- Below about `5%` a 110 ms sine is at the edge of audibility on laptop speakers, and 16-bit quantisation starts to coarsen it.
- An unparseable `CLAUDE_CHIMES_VOLUME` is treated as unset, so a typo in a shell profile cannot silently override the config file.

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
