#!/usr/bin/env node
/**
 * Stop-hook: play a 4-note chime seeded by Claude session ID.
 * Range: E4 up to E6 — two octaves, 25 semitones. Picks 4 distinct
 * semitones from the session-ID hash and plays them in hash order.
 * Pure Node.js stdlib only.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const A4_HZ = 440.0;
const SEMITONE_RATIO = 2 ** (1 / 12);
const LOW_SEMITONE = -5; // E4
const HIGH_SEMITONE = 19; // E6
const NOTE_COUNT = HIGH_SEMITONE - LOW_SEMITONE + 1; // 25
const NOTES_PER_CHIME = 4;
const SAMPLE_RATE = 44_100;
const NOTE_DURATION_S = 0.11;
const GAP_S = 0.02;
const AMPLITUDE = 0.35;

function freqFor(index) {
	return A4_HZ * SEMITONE_RATIO ** (index + LOW_SEMITONE);
}

function pickNotes(seed) {
	const digest = crypto.createHash("sha256").update(seed, "utf8").digest();
	const picks = [];
	for (const b of digest) {
		const n = b % NOTE_COUNT;
		if (!picks.includes(n)) picks.push(n);
		if (picks.length === NOTES_PER_CHIME) break;
	}
	while (picks.length < NOTES_PER_CHIME)
		picks.push((picks[picks.length - 1] + 5) % NOTE_COUNT);
	return picks;
}

function renderWav(notes) {
	const noteSamples = Math.floor(SAMPLE_RATE * NOTE_DURATION_S);
	const gapSamples = Math.floor(SAMPLE_RATE * GAP_S);
	const attack = Math.max(1, Math.floor(noteSamples * 0.05));
	const release = Math.max(1, Math.floor(noteSamples * 0.3));
	const totalSamples = notes.length * (noteSamples + gapSamples);
	const dataBytes = totalSamples * 2; // 16-bit mono
	const buf = Buffer.alloc(44 + dataBytes);

	buf.write("RIFF", 0, "ascii");
	buf.writeUInt32LE(36 + dataBytes, 4);
	buf.write("WAVE", 8, "ascii");
	buf.write("fmt ", 12, "ascii");
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(SAMPLE_RATE, 24);
	buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write("data", 36, "ascii");
	buf.writeUInt32LE(dataBytes, 40);

	let off = 44;
	for (const index of notes) {
		const f = freqFor(index);
		for (let i = 0; i < noteSamples; i++) {
			let env;
			if (i < attack) env = i / attack;
			else if (i > noteSamples - release)
				env = Math.max(0, (noteSamples - i) / release);
			else env = 1.0;
			const s = Math.round(
				AMPLITUDE * env * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE) * 32767,
			);
			buf.writeInt16LE(s, off);
			off += 2;
		}
		buf.fill(0, off, off + gapSamples * 2);
		off += gapSamples * 2;
	}

	return buf;
}

function play(notes, wavPath) {
	if (process.platform === "win32") {
		// spawnSync keeps PowerShell in the foreground — [Console]::Beep requires
		// a real console context and silently does nothing in a detached process.
		const durationMs = Math.round(NOTE_DURATION_S * 1000);
		const gapMs = Math.round(GAP_S * 1000);
		const beeps = notes
			.map(
				(i) =>
					`[Console]::Beep(${Math.round(freqFor(i))}, ${durationMs}); Start-Sleep -Milliseconds ${gapMs}`,
			)
			.join("; ");
		spawnSync(
			"powershell",
			["-NoProfile", "-NonInteractive", "-Command", beeps],
			{ stdio: "ignore" },
		);
	} else if (process.platform === "darwin") {
		const child = spawn("afplay", [wavPath], {
			stdio: "ignore",
			detached: true,
		});
		child.unref();
	} else {
		const avail = (cmd) =>
			spawnSync("which", [cmd], { stdio: "pipe" }).status === 0;
		for (const p of ["paplay", "aplay", "play", "ffplay"]) {
			if (avail(p)) {
				const args =
					p === "ffplay"
						? ["-nodisp", "-autoexit", "-loglevel", "quiet", wavPath]
						: [wavPath];
				const child = spawn(p, args, { stdio: "ignore", detached: true });
				child.unref();
				break;
			}
		}
	}
}

function run(stdinData) {
	let payload = {};
	try {
		if (stdinData.trim()) payload = JSON.parse(stdinData);
	} catch (_) {}

	const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID;
	const seed = sessionId || `ad-hoc-${Date.now()}-${process.pid}`;
	const notes = pickNotes(seed);

	if (process.platform === "win32") {
		play(notes, null);
	} else {
		const suffix = sessionId || `${Date.now()}-${process.pid}`;
		const wavPath = path.join(os.tmpdir(), `claude-chime-${suffix}.wav`);
		fs.writeFileSync(wavPath, renderWav(notes));
		play(notes, wavPath);
	}

	process.exit(0);
}

if (process.stdin.isTTY) {
	run("");
} else {
	let data = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (c) => {
		data += c;
	});
	process.stdin.on("end", () => run(data));
}
