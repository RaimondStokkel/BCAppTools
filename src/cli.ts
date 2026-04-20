#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Layer 2 – Commander CLI that exposes Layer 1 as commands.
// All output goes through the json-envelope helper when --json
// is present; otherwise a human-readable summary is printed.
// ─────────────────────────────────────────────────────────────

import { Command } from "commander";
import { publishToContainer, runContainerTests } from "./bcContainer.js";
import { publishToSandbox } from "./bcSandbox.js";
import type { BcResult } from "./types.js";

const program = new Command();

program
  .name("bc-tools")
  .description("CLI for managing Dynamics 365 Business Central extensions")
  .version("1.0.0");

// ── publish-local ────────────────────────────────────────────

program
  .command("publish-local")
  .description("Publish an .app file to a local BC container")
  .requiredOption("-c, --container <name>", "Docker container name")
  .requiredOption("-a, --app <path>", "Path to the .app file")
  .option("--json", "Output strict JSON envelope")
  .action(async (opts: { container: string; app: string; json?: boolean }) => {
    const result = await publishToContainer(opts.container, opts.app);
    output(result, opts.json);
  });

// ── publish-cloud ────────────────────────────────────────────

program
  .command("publish-cloud")
  .description("Publish an .app file to a BC SaaS sandbox via Automation API")
  .requiredOption("-t, --tenant <id>", "Azure AD tenant ID")
  .requiredOption("-e, --environment <name>", "BC environment name")
  .requiredOption("--company <id>", "BC company ID (GUID)")
  .requiredOption("-a, --app <path>", "Path to the .app file")
  .requiredOption("--token <bearer>", "OAuth2 bearer token")
  .option("--json", "Output strict JSON envelope")
  .action(
    async (opts: {
      tenant: string;
      environment: string;
      company: string;
      app: string;
      token: string;
      json?: boolean;
    }) => {
      const result = await publishToSandbox({
        tenantId: opts.tenant,
        environment: opts.environment,
        companyId: opts.company,
        appPath: opts.app,
        token: opts.token,
      });
      output(result, opts.json);
    },
  );

// ── run-tests ────────────────────────────────────────────────

program
  .command("run-tests")
  .description("Run AL tests inside a local BC container")
  .requiredOption("-c, --container <name>", "Docker container name")
  .option("--json", "Output strict JSON envelope")
  .action(async (opts: { container: string; json?: boolean }) => {
    const result = await runContainerTests(opts.container);
    output(result, opts.json);
  });

// ── Output helper ────────────────────────────────────────────

function output(result: BcResult, json?: boolean): void {
  if (json) {
    // Strict JSON-only: no extra console.log noise
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const icon = result.success ? "✔" : "✘";
    console.log(`${icon}  ${result.message}`);
    if (!result.success && result.data) {
      console.log(JSON.stringify(result.data, null, 2));
    }
  }
  process.exitCode = result.success ? 0 : 1;
}

// ── Run ──────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const envelope: BcResult = { success: false, message: msg, data: null };
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
  process.exitCode = 1;
});
