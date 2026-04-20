#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Layer 3 – MCP Server that exposes Layer 1 to AI agents.
//
// Communicates via stdio transport. Registers four tools that
// map 1-to-1 to the execution-layer functions.
// ─────────────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  publishToContainer,
  runContainerTests,
  validateContainer,
} from "./bcContainer.js";
import { publishToSandbox } from "./bcSandbox.js";
import type { BcResult } from "./types.js";

// ── Server instance ──────────────────────────────────────────

const server = new McpServer({
  name: "bc-app-tools",
  version: "1.0.0",
});

// ── Tool: bc_validate_container ──────────────────────────────

server.tool(
  "bc_validate_container",
  "Validate that a local Business Central Docker container is running and contains the expected installed apps, typically production and test apps.",
  {
    containerName: z.string().describe("Name of the Docker container running BC"),
    tenant: z.string().optional().describe("Optional BC tenant name or ID"),
    expectedApps: z
      .array(z.string())
      .optional()
      .describe("Optional list of expected installed app names"),
  },
  async ({ containerName, tenant, expectedApps }) => {
    const result = await validateContainer({
      containerName,
      tenant,
      expectedApps,
    });
    return toMcpResponse(result);
  },
);

// ── Tool: bc_publish_local ───────────────────────────────────

server.tool(
  "bc_publish_local",
  "Publish an .app extension to a local Business Central Docker container via BcContainerHelper.",
  {
    containerName: z.string().describe("Name of the Docker container running BC"),
    appPath: z.string().describe("Absolute path to the .app file to publish"),
  },
  async ({ containerName, appPath }) => {
    const result = await publishToContainer(containerName, appPath);
    return toMcpResponse(result);
  },
);

// ── Tool: bc_publish_cloud ───────────────────────────────────

server.tool(
  "bc_publish_cloud",
  "Upload an .app extension to a Business Central SaaS sandbox via the Automation API v2.0.",
  {
    tenantId: z.string().describe("Azure AD tenant ID (GUID)"),
    environment: z.string().describe("BC environment name, e.g. 'sandbox'"),
    companyId: z.string().describe("BC company ID (GUID)"),
    appPath: z.string().describe("Absolute path to the .app file to upload"),
    token: z.string().describe("OAuth2 bearer token for the Automation API"),
  },
  async ({ tenantId, environment, companyId, appPath, token }) => {
    const result = await publishToSandbox({
      tenantId,
      environment,
      companyId,
      appPath,
      token,
    });
    return toMcpResponse(result);
  },
);

// ── Tool: bc_run_tests ───────────────────────────────────────

server.tool(
  "bc_run_tests",
  "Run AL unit tests inside a local Business Central Docker container and return parsed results.",
  {
    containerName: z.string().describe("Name of the Docker container running BC"),
  },
  async ({ containerName }) => {
    const result = await runContainerTests(containerName);
    return toMcpResponse(result);
  },
);

// ── MCP response formatter ───────────────────────────────────

function toMcpResponse(result: BcResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: !result.success,
  };
}

// ── Start server ─────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
