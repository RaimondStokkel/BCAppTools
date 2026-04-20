// ─────────────────────────────────────────────────────────────
// Layer 1 – Execution logic for BcContainerHelper operations.
// ─────────────────────────────────────────────────────────────

import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runPowerShell } from "./powershell.js";
import type {
  BcResult,
  ContainerAppInfo,
  ContainerExpectedAppResult,
  ContainerValidationReport,
  TestRunReport,
  TestMethodResult,
  ValidateContainerParams,
} from "./types.js";

// ── Publish to local container ───────────────────────────────

const RawContainerAppInfoSchema = z.object({
  appId: z.string().nullish(),
  name: z.string(),
  publisher: z.string().nullish(),
  version: z.string().nullish(),
  isInstalled: z.boolean(),
  isPublished: z.boolean().nullish(),
  syncState: z.string().nullish(),
  extensionType: z.string().nullish(),
});

const RawContainerValidationSchema = z.object({
  containerName: z.string(),
  tenant: z.string().nullish(),
  containerId: z.string().nullish(),
  containerStatus: z.string(),
  isRunning: z.boolean(),
  apps: z
    .union([
      RawContainerAppInfoSchema.array(),
      RawContainerAppInfoSchema,
      z.null(),
      z.undefined(),
    ])
    .transform((value) => {
      if (!value) {
        return [];
      }

      return Array.isArray(value) ? value : [value];
    }),
});

export async function validateContainer(
  params: ValidateContainerParams,
): Promise<BcResult<ContainerValidationReport>> {
  const { containerName, tenant, expectedApps = [] } = params;
  const result = await runPowerShell(
    buildValidateContainerScript(containerName, tenant),
    { summarizeOutput: false },
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      message: `Container validation failed: ${summarizePowerShellFailure(result.stderr || result.stdout)}`,
      data: emptyContainerValidationReport(containerName, tenant, expectedApps),
    };
  }

  let parsed: z.infer<typeof RawContainerValidationSchema>;
  try {
    parsed = RawContainerValidationSchema.parse(JSON.parse(result.stdout));
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unable to parse validation output.";
    return {
      success: false,
      message: `Container validation failed: ${message}`,
      data: emptyContainerValidationReport(containerName, tenant, expectedApps),
    };
  }

  const apps = parsed.apps.map(toContainerAppInfo);
  const installedApps = apps.filter((app) => app.isInstalled);
  const testApps = installedApps.filter((app) => /test/i.test(app.name));
  const expectedAppResults = expectedApps.map((expectedName) =>
    validateExpectedApp(expectedName, installedApps),
  );
  const missingApps = expectedAppResults
    .filter((app) => !app.isInstalled)
    .map((app) => app.expectedName);

  const report: ContainerValidationReport = {
    containerName: parsed.containerName,
    tenant: parsed.tenant ?? undefined,
    containerId: parsed.containerId ?? undefined,
    containerStatus: parsed.containerStatus,
    isRunning: parsed.isRunning,
    apps,
    installedApps,
    testApps,
    expectedApps: expectedAppResults,
    missingApps,
  };

  if (!report.isRunning) {
    return {
      success: false,
      message: `Container '${containerName}' is '${report.containerStatus}' and not ready for validation.`,
      data: report,
    };
  }

  if (missingApps.length > 0) {
    return {
      success: false,
      message: `Container '${containerName}' is running but missing expected installed app(s): ${missingApps.join(", ")}.`,
      data: report,
    };
  }

  if (expectedApps.length > 0) {
    return {
      success: true,
      message: `Container '${containerName}' is running and contains all expected app(s).`,
      data: report,
    };
  }

  return {
    success: true,
    message: `Container '${containerName}' is running with ${installedApps.length} installed app(s), including ${testApps.length} test app(s).`,
    data: report,
  };
}

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

function buildValidateContainerScript(
  containerName: string,
  tenant?: string,
): string {
  const escapedContainerName = escapePs(containerName);
  const tenantOption = tenant ? ` -tenant '${escapePs(tenant)}'` : "";
  const tenantValue = tenant ? `'${escapePs(tenant)}'` : "$null";

  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'

$containerJson = docker inspect '${escapedContainerName}' 2>$null
if (-not $containerJson) {
  throw "Container '${escapedContainerName}' was not found or Docker is unavailable."
}

$container = $containerJson | ConvertFrom-Json
$containerIsMissing = (-not $container) -or (($container -is [System.Array]) -and $container.Count -eq 0)
if ($containerIsMissing) {
  throw "Container '${escapedContainerName}' was not found or Docker is unavailable."
}

$containerItem = if ($container -is [System.Array]) { $container[0] } else { $container }
$apps = @()

if ($containerItem.State.Running) {
  Import-Module BcContainerHelper -ErrorAction Stop | Out-Null
  $apps = @(
    Get-BcContainerAppInfo -containerName '${escapedContainerName}'${tenantOption} |
      Select-Object
        @{Name='appId';Expression={ if ($_.AppId) { [string]$_.AppId } elseif ($_.Id) { [string]$_.Id } else { $null } }},
        @{Name='name';Expression={ [string]$_.Name }},
        @{Name='publisher';Expression={ [string]$_.Publisher }},
        @{Name='version';Expression={ [string]$_.Version }},
        @{Name='isInstalled';Expression={ [bool]$_.IsInstalled }},
        @{Name='isPublished';Expression={ if ($null -ne $_.IsPublished) { [bool]$_.IsPublished } else { $null } }},
        @{Name='syncState';Expression={ if ($_.SyncState) { [string]$_.SyncState } else { $null } }},
        @{Name='extensionType';Expression={ if ($_.ExtensionType) { [string]$_.ExtensionType } else { $null } }}
  )
}

[pscustomobject]@{
  containerName = '${escapedContainerName}'
  tenant = ${tenantValue}
  containerId = [string]$containerItem.Id
  containerStatus = [string]$containerItem.State.Status
  isRunning = [bool]$containerItem.State.Running
  apps = $apps
} | ConvertTo-Json -Depth 8 -Compress
`.trim();
}

function toContainerAppInfo(
  app: z.infer<typeof RawContainerAppInfoSchema>,
): ContainerAppInfo {
  return {
    appId: app.appId ?? undefined,
    name: app.name,
    publisher: app.publisher ?? undefined,
    version: app.version ?? undefined,
    isInstalled: app.isInstalled,
    isPublished: app.isPublished ?? undefined,
    syncState: app.syncState ?? undefined,
    extensionType: app.extensionType ?? undefined,
  };
}

function validateExpectedApp(
  expectedName: string,
  installedApps: ContainerAppInfo[],
): ContainerExpectedAppResult {
  const matchedApp = installedApps.find(
    (app) => normalizeAppName(app.name) === normalizeAppName(expectedName),
  );

  return {
    expectedName,
    isInstalled: matchedApp !== undefined,
    matchedApp,
  };
}

function normalizeAppName(value: string): string {
  return value.trim().toLowerCase();
}

function emptyContainerValidationReport(
  containerName: string,
  tenant: string | undefined,
  expectedApps: string[],
): ContainerValidationReport {
  return {
    containerName,
    tenant,
    containerId: undefined,
    containerStatus: "unknown",
    isRunning: false,
    apps: [],
    installedApps: [],
    testApps: [],
    expectedApps: expectedApps.map((expectedName) => ({
      expectedName,
      isInstalled: false,
    })),
    missingApps: [...expectedApps],
  };
}

function summarizePowerShellFailure(output: string): string {
  const cleanedLines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (cleanedLines.length === 0) {
    return "Unknown error.";
  }

  const lastLine = cleanedLines[cleanedLines.length - 1];
  return lastLine.replace(/^\|+\s*/, "").trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}
