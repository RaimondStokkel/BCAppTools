# BCAppTools

CLI and MCP server for managing **Dynamics 365 Business Central** extensions. Validate local test containers, publish `.app` files to local Docker containers or cloud sandboxes, and run AL unit tests — from the terminal or through any MCP-compatible AI agent.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Architecture](#architecture)
- [CLI Usage](#cli-usage)
  - [validate-container](#validate-container)
  - [publish-local](#publish-local)
  - [publish-cloud](#publish-cloud)
  - [run-tests](#run-tests)
  - [JSON Output Mode](#json-output-mode)
- [MCP Server Usage](#mcp-server-usage)
  - [Starting the Server](#starting-the-server)
  - [Configuring in VS Code / Copilot](#configuring-in-vs-code--copilot)
  - [Available Tools](#available-tools)
- [Response Format](#response-format)
- [Error Handling](#error-handling)
- [Project Structure](#project-structure)
- [Development](#development)
- [License](#license)

---

## Prerequisites

| Requirement | Purpose |
|---|---|
| **Node.js ≥ 18** | Runtime (uses native `fetch`) |
| **PowerShell 7+ (pwsh)** | Executes BcContainerHelper cmdlets |
| **BcContainerHelper** module | Installed in PowerShell (`Install-Module BcContainerHelper`) |
| **Docker Desktop** | Required for local container commands |
| **OAuth2 token** | Required for cloud publish (Azure AD app registration) |

## Installation

```bash
# Clone and build
git clone https://github.com/RaimondStokkel/BCAppTools.git
cd BCAppTools
npm install
npm run build

# (Optional) Make the CLI available globally
npm link
```

After `npm link`, the commands `bc-tools` and `bc-tools-mcp` are available on your PATH.

---

## Architecture

The project follows a strict 3-layer pattern — no layer references a layer above it:

```
┌─────────────────────────────────────────────────┐
│  Layer 3 — MCP Server (mcp-server.ts)           │  AI agents (Copilot, Claude, etc.)
│  Stdio transport · Zod-validated tool schemas    │
├─────────────────────────────────────────────────┤
│  Layer 2 — CLI (cli.ts)                         │  Human operators / CI pipelines
│  Commander commands · --json flag                │
├─────────────────────────────────────────────────┤
│  Layer 1 — Execution Logic                      │  Pure business logic
│  bcContainer.ts  →  BcContainerHelper via pwsh  │
│  bcSandbox.ts    →  Automation API v2.0 (REST)  │
│  powershell.ts   →  PowerShell runner + parser  │
└─────────────────────────────────────────────────┘
```

---

## CLI Usage

```bash
bc-tools <command> [options]
```

### publish-local

Publish an `.app` file to a local Business Central Docker container using `Publish-BcContainerApp`.

```bash
bc-tools publish-local \
  --container bcserver \
  --app ./output/MyExtension_1.0.0.0.app
```

| Flag | Short | Required | Description |
|---|---|---|---|
| `--container <name>` | `-c` | ✅ | Docker container name |
| `--app <path>` | `-a` | ✅ | Path to the `.app` file |
| `--json` | | | Output as strict JSON envelope |

### validate-container

Validate that a local BC container is running and that the expected apps are already installed. This is useful as a **preflight step** before publishing or running tests.

```bash
bc-tools validate-container \
  --container bcserver \
  --expect-app "EmpireFinance" \
  --expect-app "EmpireFinanceTests" \
  --json
```

| Flag | Short | Required | Description |
|---|---|---|---|
| `--container <name>` | `-c` | ✅ | Docker container name |
| `--tenant <name>` | | | Optional BC tenant name or ID |
| `--expect-app <name>` | | | Expected installed app name; repeat for production and test apps |
| `--json` | | | Output as strict JSON envelope |

When `--expect-app` is used, the command fails if the container is not running or if any expected app is missing from the installed apps list.

### publish-cloud

Upload an `.app` file to a Business Central SaaS sandbox via the Automation API v2.0.

```bash
bc-tools publish-cloud \
  --tenant "00000000-0000-0000-0000-000000000000" \
  --environment "sandbox" \
  --company "00000000-0000-0000-0000-000000000000" \
  --app ./output/MyExtension_1.0.0.0.app \
  --token "eyJ0eXAi..."
```

| Flag | Short | Required | Description |
|---|---|---|---|
| `--tenant <id>` | `-t` | ✅ | Azure AD tenant ID (GUID) |
| `--environment <name>` | `-e` | ✅ | BC environment name (e.g. `sandbox`) |
| `--company <id>` | | ✅ | BC company ID (GUID) |
| `--app <path>` | `-a` | ✅ | Path to the `.app` file |
| `--token <bearer>` | | ✅ | OAuth2 bearer token |
| `--json` | | | Output as strict JSON envelope |

> **Tip:** Use `az account get-access-token --resource https://api.businesscentral.dynamics.com` to obtain a bearer token for testing.

### run-tests

Run all AL unit tests inside a local BC container using `Run-TestsInBcContainer`. The test results XML is automatically parsed into a structured report.

```bash
bc-tools run-tests --container bcserver
```

| Flag | Short | Required | Description |
|---|---|---|---|
| `--container <name>` | `-c` | ✅ | Docker container name |
| `--json` | | | Output as strict JSON envelope |

### JSON Output Mode

Every command supports a `--json` flag. When set, the CLI suppresses all human-readable output and writes a single JSON object to stdout:

```bash
bc-tools run-tests -c bcserver --json
```

```json
{
  "success": true,
  "message": "All 14 test(s) passed.",
  "data": {
    "totalTests": 14,
    "passed": 14,
    "failed": 0,
    "skipped": 0,
    "durationMs": 3420,
    "tests": [
      {
        "name": "TestPostSalesInvoice",
        "codeunitName": "SalesTests",
        "result": "Passed",
        "durationMs": 512
      }
    ]
  }
}
```

The exit code is `0` on success, `1` on failure — suitable for CI/CD pipelines.

Example validation response:

```json
{
  "success": true,
  "message": "Container 'bcserver' is running and contains all expected app(s).",
  "data": {
    "containerName": "bcserver",
    "containerStatus": "running",
    "isRunning": true,
    "expectedApps": [
      {
        "expectedName": "EmpireFinance",
        "isInstalled": true
      },
      {
        "expectedName": "EmpireFinanceTests",
        "isInstalled": true
      }
    ],
    "missingApps": []
  }
}
```

---

## MCP Server Usage

The MCP (Model Context Protocol) server lets AI agents call the same functionality via a standardised tool interface over stdio.

### Starting the Server

```bash
# Directly
node dist/mcp-server.js

# Or via npm script
npm run mcp

# Or if globally linked
bc-tools-mcp
```

The server communicates over **stdin/stdout** using the MCP JSON-RPC protocol. It does not start an HTTP server.

### Configuring in VS Code / Copilot

Add the server to your MCP configuration file (e.g. `.vscode/mcp.json` or VS Code settings):

```json
{
  "servers": {
    "bc-app-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/BCAppTools/dist/mcp-server.js"]
    }
  }
}
```

Or if you have the package globally linked:

```json
{
  "servers": {
    "bc-app-tools": {
      "type": "stdio",
      "command": "bc-tools-mcp"
    }
  }
}
```

### Available Tools

Once connected, the AI agent can call four tools:

#### `bc_validate_container`

Validate that a local container is running and already contains the expected installed apps.

| Parameter | Type | Description |
|---|---|---|
| `containerName` | `string` | Name of the Docker container running BC |
| `tenant` | `string` | Optional BC tenant name or ID |
| `expectedApps` | `string[]` | Optional list of expected installed app names |

#### `bc_publish_local`

Publish an `.app` to a local Docker container.

| Parameter | Type | Description |
|---|---|---|
| `containerName` | `string` | Name of the Docker container running BC |
| `appPath` | `string` | Absolute path to the `.app` file |

#### `bc_publish_cloud`

Upload an `.app` to a BC SaaS sandbox.

| Parameter | Type | Description |
|---|---|---|
| `tenantId` | `string` | Azure AD tenant ID (GUID) |
| `environment` | `string` | BC environment name, e.g. `sandbox` |
| `companyId` | `string` | BC company ID (GUID) |
| `appPath` | `string` | Absolute path to the `.app` file |
| `token` | `string` | OAuth2 bearer token |

#### `bc_run_tests`

Run AL unit tests in a local Docker container.

| Parameter | Type | Description |
|---|---|---|
| `containerName` | `string` | Name of the Docker container running BC |

All MCP tool responses use the same `{ success, message, data }` envelope, wrapped in an MCP `text` content block. The `isError` flag is set when `success` is `false`.

---

## Response Format

Every operation — whether invoked via CLI or MCP — returns the same envelope:

```typescript
interface BcResult<T = unknown> {
  success: boolean;   // true if the operation completed without errors
  message: string;    // human-readable summary
  data: T;            // operation-specific payload
}
```

### Test Run Data

The `run-tests` data payload is a structured `TestRunReport`:

```typescript
interface TestRunReport {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tests: TestMethodResult[];
}

interface TestMethodResult {
  name: string;           // test method name
  codeunitName: string;   // AL codeunit name
  result: "Passed" | "Failed" | "Skipped";
  durationMs: number;
  errorMessage?: string;  // only on failure
  stackTrace?: string;    // first 5 lines, only on failure
}
```

### Container Validation Data

The `validate-container` payload is a structured `ContainerValidationReport`:

```typescript
interface ContainerValidationReport {
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
```

---

## Error Handling

BCAppTools parses and summarises errors instead of returning raw PowerShell output:

- **AL compiler errors** (e.g. `AL0132`, `AL0118`) are extracted with file, line, and column information:
  ```
  AL0132 at MyPage.al:45 – The name 'xyz' does not exist in the current context
  ```
- **Long output** is truncated to 60 lines (first 20 + last 20 with an omission notice) so AI agents don't choke on 200-line stack traces.
- **Cloud API errors** extract the OData error message from the JSON response body when available.
- **Network failures** are caught and returned as structured errors, not thrown exceptions.

---

## Project Structure

```
BCAppTools/
├── src/
│   ├── types.ts          # Shared TypeScript interfaces
│   ├── powershell.ts      # Layer 1: PowerShell runner + AL error parser
│   ├── bcContainer.ts     # Layer 1: Container publish + test execution
│   ├── bcSandbox.ts       # Layer 1: Cloud sandbox publish via REST
│   ├── cli.ts             # Layer 2: Commander CLI
│   └── mcp-server.ts      # Layer 3: MCP stdio server
├── dist/                  # Compiled JS (generated by `npm run build`)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development

```bash
# Install dependencies
npm install

# Build once
npm run build

# Watch mode (rebuild on save)
npm run dev

# Type-check without emitting
npm run lint

# Run CLI directly during development
node dist/cli.js publish-local -c mycontainer -a ./app.app --json

# Test the MCP server interactively (pipe JSON-RPC messages)
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node dist/mcp-server.js
```

---

## License

[MIT](LICENSE)
