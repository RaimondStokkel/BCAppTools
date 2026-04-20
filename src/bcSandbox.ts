// ─────────────────────────────────────────────────────────────
// Layer 1 – Execution logic for BC Sandbox (cloud) operations.
// ─────────────────────────────────────────────────────────────

import { readFile, stat } from "node:fs/promises";
import type { BcResult, SandboxPublishParams } from "./types.js";

/**
 * Publish an .app file to a Business Central SaaS sandbox
 * environment via the Automation API v2.0.
 *
 * Endpoint:
 *   POST https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/microsoft/automation/v2.0/companies({companyId})/extensions
 */
export async function publishToSandbox(
  params: SandboxPublishParams,
): Promise<BcResult> {
  const { tenantId, environment, companyId, appPath, token } = params;

  // Validate the app file exists and has a reasonable size
  const fileStat = await stat(appPath).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    return {
      success: false,
      message: `App file not found: ${appPath}`,
      data: null,
    };
  }

  const appBuffer = await readFile(appPath);

  const url = [
    `https://api.businesscentral.dynamics.com/v2.0`,
    `/${encodeURIComponent(tenantId)}`,
    `/${encodeURIComponent(environment)}`,
    `/api/microsoft/automation/v2.0`,
    `/companies(${companyId})`,
    `/extensionUpload/extensionContent`,
  ].join("");

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "If-Match": "*",
      },
      body: appBuffer,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Network error uploading app: ${msg}`,
      data: null,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const errorDetail = tryExtractODataError(body) ?? body.slice(0, 500);
    return {
      success: false,
      message: `Upload failed (HTTP ${response.status}): ${errorDetail}`,
      data: { status: response.status, body: errorDetail },
    };
  }

  return {
    success: true,
    message: `App uploaded to ${environment} (tenant ${tenantId}) successfully.`,
    data: { status: response.status },
  };
}

// ── Helpers ──────────────────────────────────────────────────

function tryExtractODataError(body: string): string | null {
  try {
    const json = JSON.parse(body) as {
      error?: { code?: string; message?: string };
    };
    if (json.error?.message) {
      return `${json.error.code ?? "Error"}: ${json.error.message}`;
    }
  } catch {
    // not JSON
  }
  return null;
}
