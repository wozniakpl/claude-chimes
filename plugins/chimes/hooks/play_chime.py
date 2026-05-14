#!/usr/bin/env python3
"""Stop-hook: play a 4-note chime seeded by Claude session ID.

Range: E4 up to E6 — two octaves, 25 semitones inclusive (A4 = 440 Hz is
the reference). Picks 4 distinct semitones from the session-ID hash and
plays them in hash order. Stdlib only; detects the host OS for playback.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path
from shutil import which

A4_HZ = 440.0
SEMITONE_RATIO = 2 ** (1 / 12)
# Note range expressed as semitone offsets from A4: E4 = -5, E6 = +19.
LOW_SEMITONE = -5
HIGH_SEMITONE = 19
NOTE_COUNT = HIGH_SEMITONE - LOW_SEMITONE + 1  # 25 notes, 2 octaves
NOTES_PER_CHIME = 4
SAMPLE_RATE = 44_100
NOTE_DURATION_S = 0.11
GAP_S = 0.02
AMPLITUDE = 0.35


def freq_for(index: int) -> float:
    """Map index in [0, NOTE_COUNT) to a frequency in Hz."""
    return A4_HZ * (SEMITONE_RATIO ** (index + LOW_SEMITONE))


def pick_notes(seed: str) -> list[int]:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    picks: list[int] = []
    for b in digest:
        n = b % NOTE_COUNT
        if n not in picks:
            picks.append(n)
        if len(picks) == NOTES_PER_CHIME:
            break
    while len(picks) < NOTES_PER_CHIME:  # extraordinarily unlikely
        picks.append((picks[-1] + 5) % NOTE_COUNT)
    return picks


def render_wav(notes: list[int], path: Path) -> None:
    note_samples = int(SAMPLE_RATE * NOTE_DURATION_S)
    gap_samples = int(SAMPLE_RATE * GAP_S)
    attack = max(1, int(note_samples * 0.05))
    release = max(1, int(note_samples * 0.30))
    frames = bytearray()
    for index in notes:
        f = freq_for(index)
        for i in range(note_samples):
            if i < attack:
                env = i / attack
            elif i > note_samples - release:
                env = max(0.0, (note_samples - i) / release)
            else:
                env = 1.0
            sample = AMPLITUDE * env * math.sin(2 * math.pi * f * i / SAMPLE_RATE)
            frames.extend(struct.pack("<h", int(sample * 32767)))
        frames.extend(b"\x00\x00" * gap_samples)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(frames))


def play(path: Path) -> None:
    devnull = subprocess.DEVNULL
    if sys.platform == "darwin":
        subprocess.Popen(["afplay", str(path)], stdout=devnull, stderr=devnull)
        return
    if sys.platform == "win32":
        import winsound
        winsound.PlaySound(str(path), winsound.SND_FILENAME | winsound.SND_ASYNC)
        return
    for player in ("paplay", "aplay", "play", "ffplay"):
        if which(player):
            args = [player, str(path)]
            if player == "ffplay":
                args = ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", str(path)]
            subprocess.Popen(args, stdout=devnull, stderr=devnull)
            return


def main() -> int:
    payload: dict = {}
    if not sys.stdin.isatty():
        raw = sys.stdin.read()
        if raw.strip():
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {}
    session_id = payload.get("session_id") or os.environ.get("CLAUDE_SESSION_ID")
    seed = session_id or f"ad-hoc-{time.time_ns()}-{os.getpid()}"
    notes = pick_notes(seed)
    suffix = session_id or f"{time.time_ns()}-{os.getpid()}"
    out = Path(tempfile.gettempdir()) / f"claude-chime-{suffix}.wav"
    render_wav(notes, out)
    play(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
