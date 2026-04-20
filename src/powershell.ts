// ─────────────────────────────────────────────────────────────
// Layer 1 – PowerShell helpers: execute commands, parse output.
// ─────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import type { AlCompilerError, PsExecutionResult } from "./types.js";

const POWERSHELL = "pwsh";

/**
 * Run a PowerShell command and return parsed results.
 * Captures stdout/stderr, extracts AL compiler errors, and trims
 * the raw output so callers never see 200-line stack traces.
 */
export function runPowerShell(script: string): Promise<PsExecutionResult> {
  return new Promise((resolve) => {
    execFile(
      POWERSHELL,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode = error?.code
          ? (typeof error.code === "number" ? error.code : 1)
          : 0;
        const errors = parseAlErrors(stdout + "\n" + stderr);
        resolve({
          exitCode,
          stdout: summariseOutput(stdout),
          stderr: summariseOutput(stderr),
          errors,
        });
      },
    );
  });
}

// ── AL error extraction ──────────────────────────────────────

const AL_ERROR_RE =
  /(?<file>[^\s(]+)\((?<line>\d+),(?<col>\d+)\)\s*:\s*(?<severity>error|warning)\s+(?<code>AL\d+)\s*:\s*(?<msg>.+)/gi;

function parseAlErrors(text: string): AlCompilerError[] {
  const errors: AlCompilerError[] = [];
  let match: RegExpExecArray | null;
  while ((match = AL_ERROR_RE.exec(text)) !== null) {
    const g = match.groups!;
    errors.push({
      code: g["code"],
      message: g["msg"].trim(),
      file: g["file"],
      line: Number(g["line"]),
      column: Number(g["col"]),
    });
  }
  // Reset the regex state for the next call
  AL_ERROR_RE.lastIndex = 0;
  return errors;
}

// ── Output summarisation ─────────────────────────────────────

const MAX_LINES = 60;

function summariseOutput(raw: string): string {
  const lines = raw.split("\n");
  if (lines.length <= MAX_LINES) return raw.trim();
  const head = lines.slice(0, 20);
  const tail = lines.slice(-20);
  return [
    ...head,
    `\n... (${lines.length - 40} lines omitted) ...\n`,
    ...tail,
  ]
    .join("\n")
    .trim();
}
