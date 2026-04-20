// ─────────────────────────────────────────────────────────────
// Layer 1 – Execution logic for BcContainerHelper operations.
// ─────────────────────────────────────────────────────────────

import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPowerShell } from "./powershell.js";
import type { BcResult, TestRunReport, TestMethodResult } from "./types.js";

// ── Publish to local container ───────────────────────────────

export async function publishToContainer(
  containerName: string,
  appPath: string,
): Promise<BcResult> {
  const script = [
    `Publish-BcContainerApp`,
    `-containerName '${escapePs(containerName)}'`,
    `-appFile '${escapePs(appPath)}'`,
    `-install`,
    `-skipVerification`,
  ].join(" ");

  const result = await runPowerShell(script);

  if (result.exitCode !== 0) {
    const errorSummary =
      result.errors.length > 0
        ? result.errors
            .map((e) => `${e.code} at ${e.file ?? "?"}:${e.line ?? "?"} – ${e.message}`)
            .join("; ")
        : result.stderr || result.stdout;

    return {
      success: false,
      message: `Publish failed: ${errorSummary}`,
      data: { errors: result.errors, stdout: result.stdout },
    };
  }

  return {
    success: true,
    message: `App published to container '${containerName}' successfully.`,
    data: { stdout: result.stdout },
  };
}

// ── Run tests in container ───────────────────────────────────

export async function runContainerTests(
  containerName: string,
): Promise<BcResult<TestRunReport>> {
  const tempDir = await mkdtemp(join(tmpdir(), "bc-tests-"));

  try {
    const script = [
      `Run-TestsInBcContainer`,
      `-containerName '${escapePs(containerName)}'`,
      `-testResultsFile '${escapePs(join(tempDir, "results.xml"))}'`,
      `-detailed`,
    ].join(" ");

    const result = await runPowerShell(script);

    const report = await parseTestResults(tempDir);

    if (result.exitCode !== 0 && report.totalTests === 0) {
      const errorSummary =
        result.errors.length > 0
          ? result.errors.map((e) => `${e.code}: ${e.message}`).join("; ")
          : result.stderr || "Unknown error running tests.";

      return {
        success: false,
        message: `Test run failed: ${errorSummary}`,
        data: report,
      };
    }

    const hasFailures = report.failed > 0;
    return {
      success: !hasFailures,
      message: hasFailures
        ? `${report.failed} of ${report.totalTests} test(s) failed.`
        : `All ${report.totalTests} test(s) passed.`,
      data: report,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Test-result XML parser (NUnit 2.x style) ────────────────

async function parseTestResults(dir: string): Promise<TestRunReport> {
  const emptyReport: TestRunReport = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    tests: [],
  };

  const files = await readdir(dir).catch(() => [] as string[]);
  const xmlFile = files.find((f) => f.endsWith(".xml"));
  if (!xmlFile) return emptyReport;

  const xml = await readFile(join(dir, xmlFile), "utf-8");
  return parseNUnitXml(xml);
}

/**
 * Lightweight NUnit 2.x XML parser – avoids heavy dependencies.
 * Extracts <test-case> elements with regex (good enough for the
 * well-known BcContainerHelper output format).
 */
function parseNUnitXml(xml: string): TestRunReport {
  const tests: TestMethodResult[] = [];
  const testCaseRe =
    /<test-case\s[^>]*?name="(?<name>[^"]*)"[^>]*?result="(?<result>[^"]*)"[^>]*?time="(?<time>[^"]*)"[^>]*?>/gi;

  let match: RegExpExecArray | null;
  while ((match = testCaseRe.exec(xml)) !== null) {
    const g = match.groups!;
    const fullName = g["name"];
    const parts = fullName.split(".");
    const methodName = parts.pop() ?? fullName;
    const codeunitName = parts.pop() ?? "";

    const resultStr = g["result"].toLowerCase();
    const mapped: TestMethodResult["result"] =
      resultStr === "success" || resultStr === "passed"
        ? "Passed"
        : resultStr === "failure" || resultStr === "failed"
          ? "Failed"
          : "Skipped";

    const entry: TestMethodResult = {
      name: methodName,
      codeunitName,
      result: mapped,
      durationMs: Math.round(parseFloat(g["time"]) * 1000),
    };

    // Grab failure message if present (appears right after the tag)
    if (mapped === "Failed") {
      const afterTag = xml.slice(match.index + match[0].length, match.index + match[0].length + 2000);
      const msgMatch = afterTag.match(/<message><!\[CDATA\[(?<msg>[\s\S]*?)\]\]><\/message>/i);
      if (msgMatch?.groups?.["msg"]) {
        entry.errorMessage = msgMatch.groups["msg"].trim();
      }
      const stackMatch = afterTag.match(/<stack-trace><!\[CDATA\[(?<st>[\s\S]*?)\]\]><\/stack-trace>/i);
      if (stackMatch?.groups?.["st"]) {
        entry.stackTrace = stackMatch.groups["st"].trim().split("\n").slice(0, 5).join("\n");
      }
    }

    tests.push(entry);
  }
  testCaseRe.lastIndex = 0;

  const passed = tests.filter((t) => t.result === "Passed").length;
  const failed = tests.filter((t) => t.result === "Failed").length;
  const skipped = tests.filter((t) => t.result === "Skipped").length;
  const durationMs = tests.reduce((sum, t) => sum + t.durationMs, 0);

  return {
    totalTests: tests.length,
    passed,
    failed,
    skipped,
    durationMs,
    tests,
  };
}

// ── Helpers ──────────────────────────────────────────────────

function escapePs(value: string): string {
  return value.replace(/'/g, "''");
}
