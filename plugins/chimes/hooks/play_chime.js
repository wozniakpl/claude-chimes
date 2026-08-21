#!/usr/bin/env node
/**
 * Stop-hook: play a 4-note chime seeded by Claude session ID.
 * Range: E4 up to E6 — two octaves, 25 semitones. Picks 4 distinct
 * semitones from the session-ID hash and plays them in hash order.
 * Pure Node.js stdlib only.
 *
 * Volume is a global 0-100 percentage: CLAUDE_CHIMES_VOLUME wins over
 * ~/.claude/chimes.json, which wins over the default of 100.
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

const CONFIG_DIR =
	process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const CONFIG_PATH = path.join(CONFIG_DIR, "chimes.json");
const VOLUME_ENV = "CLAUDE_CHIMES_VOLUME";
const DEFAULT_VOLUME = 100;
const CONFIG_VERSION = 1;

/** Coerce anything into an integer 0-100, or null if it is not a usable number. */
function normalizeVolume(raw) {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "boolean") return null; // true would coerce to 1
	let n;
	if (typeof raw === "number") {
		n = raw;
	} else if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (trimmed === "") return null; // Number("") is 0, which nobody means
		n = Number(trimmed);
	} else {
		return null;
	}
	if (!Number.isFinite(n)) return null;
	return Math.min(100, Math.max(0, Math.round(n)));
}

/** Read the config file. Never throws: an unusable file reads as empty. */
function loadConfigFile() {
	let text;
	try {
		text = fs.readFileSync(CONFIG_PATH, "utf8");
	} catch (_) {
		return { obj: {}, malformed: false };
	}
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // PowerShell writes a BOM
	if (!text.trim()) return { obj: {}, malformed: false };
	let obj;
	try {
		obj = JSON.parse(text);
	} catch (_) {
		return { obj: {}, malformed: true };
	}
	if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
		return { obj: {}, malformed: true };
	}
	return { obj, malformed: false };
}

/**
 * Resolve the effective volume. Precedence: env, then file, then default.
 * An unparseable env value is treated as unset, so a typo in a shell profile
 * cannot silently override a real config file.
 */
function readVolume() {
	const fromEnv = normalizeVolume(process.env[VOLUME_ENV]);
	if (fromEnv !== null) return { volume: fromEnv, source: "env" };

	const fromFile = normalizeVolume(loadConfigFile().obj.volume);
	if (fromFile !== null) return { volume: fromFile, source: "file" };

	return { volume: DEFAULT_VOLUME, source: "default" };
}

// Windows can transiently fail a rename when a virus scanner or an editor holds
// the destination open, so retry briefly before giving up.
function renameWithRetry(from, to) {
	const delays = [0, 5, 15, 40, 100, 250];
	for (let i = 0; i < delays.length; i++) {
		if (delays[i]) {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[i]);
		}
		try {
			fs.renameSync(from, to);
			return;
		} catch (err) {
			const transient =
				err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY";
			if (!transient || i === delays.length - 1) throw err;
		}
	}
}

/** Write volume into the global config, preserving every other key. */
function setVolume(volume) {
	fs.mkdirSync(CONFIG_DIR, { recursive: true });
	const { obj, malformed } = loadConfigFile();
	if (malformed) {
		// The old keys cannot be preserved because they cannot be parsed, so keep
		// the bytes rather than destroying them silently.
		try {
			fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`);
		} catch (_) {}
	}

	const next = { ...obj, version: CONFIG_VERSION, volume };
	const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	try {
		renameWithRetry(tmp, CONFIG_PATH);
	} catch (err) {
		try {
			fs.unlinkSync(tmp);
		} catch (_) {}
		throw err;
	}
	return next;
}

/**
 * Percentage to amplitude gain. A mild power curve, so the number the user
 * types roughly tracks perceived loudness: linear amplitude leaves 50%
 * sounding nearly unchanged, while a mixer-style log fader makes 20% inaudible.
 */
function gainFor(volume) {
	if (volume <= 0) return 0;
	return (volume / 100) ** 1.5;
}

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

function renderWav(notes, amplitude) {
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
				amplitude * env * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE) * 32767,
			);
			buf.writeInt16LE(s, off);
			off += 2;
		}
		buf.fill(0, off, off + gapSamples * 2);
		off += gapSamples * 2;
	}

	return buf;
}

function play(wavPath) {
	if (process.platform === "win32") {
		// SoundPlayer sends the rendered PCM to the normal audio device, so both
		// the volume setting and the Windows mixer apply to it. The old
		// [Console]::Beep path drove the system beep, which has no volume at all.
		const escaped = wavPath.replace(/'/g, "''");
		const child = spawn(
			"powershell",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`,
			],
			{ stdio: "ignore", detached: true, windowsHide: true },
		);
		child.unref();
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

function chime(seed, volume) {
	if (volume <= 0) return; // hard mute: no render, no temp file, no child process
	const notes = pickNotes(seed);
	const safeSeed = seed.replace(/[^\w.-]/g, "_");
	const wavPath = path.join(os.tmpdir(), `claude-chime-${safeSeed}.wav`);
	fs.writeFileSync(wavPath, renderWav(notes, AMPLITUDE * gainFor(volume)));
	play(wavPath);
}

function run(stdinData) {
	const { volume } = readVolume();
	if (volume <= 0) process.exit(0);

	let payload = {};
	try {
		if (stdinData.trim()) payload = JSON.parse(stdinData);
	} catch (_) {}

	const sessionId = payload.session_id || process.env.CLAUDE_SESSION_ID;
	const seed = sessionId || `ad-hoc-${Date.now()}-${process.pid}`;
	chime(seed, volume);

	process.exit(0);
}

function describeVolume() {
	const { volume, source } = readVolume();
	const where = {
		env: `overridden by ${VOLUME_ENV}`,
		file: CONFIG_PATH,
		default: "default",
	}[source];
	return `chime volume: ${volume}% (${where})`;
}

function cli(argv) {
	const [flag, value] = argv;

	if (flag === "--get-volume") {
		console.log(describeVolume());
		process.exit(0);
	}

	if (flag === "--set-volume") {
		const volume = normalizeVolume(value);
		if (volume === null) {
			console.error(
				`usage: play_chime.js --set-volume <0-100>  (got: ${value ?? "nothing"})`,
			);
			process.exit(2);
		}
		setVolume(volume);
		console.log(`chime volume set to ${volume}% in ${CONFIG_PATH}`);
		if (normalizeVolume(process.env[VOLUME_ENV]) !== null) {
			console.log(
				`note: ${VOLUME_ENV} is set in this environment and overrides the file`,
			);
		}
		chime(`preview-${volume}`, volume); // let the user hear what they picked
		process.exit(0);
	}

	if (flag === "--play") {
		const { volume } = readVolume();
		chime(`preview-${Date.now()}`, volume);
		console.log(describeVolume());
		process.exit(0);
	}

	console.error(
		"usage: play_chime.js [--get-volume | --set-volume <0-100> | --play]",
	);
	process.exit(2);
}

if (process.argv.length > 2) {
	cli(process.argv.slice(2));
} else if (process.stdin.isTTY) {
	run("");
} else {
	let data = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (c) => {
		data += c;
	});
	process.stdin.on("end", () => run(data));
}
