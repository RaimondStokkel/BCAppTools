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

/** App discovered in a local BC container. */
export interface ContainerAppInfo {
  appId?: string;
  name: string;
  publisher?: string;
  version?: string;
  isInstalled: boolean;
  isPublished?: boolean;
  syncState?: string;
  extensionType?: string;
}

/** Validation result for a single expected app name. */
export interface ContainerExpectedAppResult {
  expectedName: string;
  isInstalled: boolean;
  matchedApp?: ContainerAppInfo;
}

/** Report returned by validateContainer. */
export interface ContainerValidationReport {
  containerName: string;
  tenant?: string;
  containerId?: string;
  containerStatus: string;
  isRunning: boolean;
  apps: ContainerAppInfo[];
  installedApps: ContainerAppInfo[];
  testApps: ContainerAppInfo[];
  expectedApps: ContainerExpectedAppResult[];
  missingApps: string[];
}

/** Parameters accepted by validateContainer. */
export interface ValidateContainerParams {
  containerName: string;
  tenant?: string;
  expectedApps?: string[];
}

/** Parameters accepted by publishToSandbox. */
export interface SandboxPublishParams {
  tenantId: string;
  environment: string;
  companyId: string;
  appPath: string;
  token: string;
}
