// ─────────────────────────────────────────────────────────────
// Shared types for BCAppTools – used across all three layers.
// ─────────────────────────────────────────────────────────────

/** Unified result envelope returned by every execution-layer function. */
export interface BcResult<T = unknown> {
  success: boolean;
  message: string;
  data: T;
}

/** A single parsed AL compiler error extracted from PowerShell output. */
export interface AlCompilerError {
  code: string;       // e.g. "AL0132"
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/** Summarised output from a PowerShell invocation. */
export interface PsExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  errors: AlCompilerError[];
}

/** A single test-method result parsed from the XML report. */
export interface TestMethodResult {
  name: string;
  codeunitName: string;
  result: "Passed" | "Failed" | "Skipped";
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
}

/** Aggregate test-run report. */
export interface TestRunReport {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tests: TestMethodResult[];
}

/** Parameters accepted by publishToSandbox. */
export interface SandboxPublishParams {
  tenantId: string;
  environment: string;
  companyId: string;
  appPath: string;
  token: string;
}
