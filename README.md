# Local MCP Server (Weather Tool)

A minimal Model Context Protocol (MCP) server exposing a single tool: `get_weather`.
It communicates over stdio and is compatible with MCP clients and the MCP Inspector.

## Features

- MCP stdio server implemented with `@modelcontextprotocol/sdk`.
- Weather tool: `get_weather` with current, hourly, and daily modes using Open‑Meteo.
- Typed validation via `zod`.

## Requirements

- Node.js 18+ (recommended LTS)
- pnpm (project sets `packageManager: pnpm@10.x`)

## Quickstart

```bash
pnpm install
pnpm dev
```

This starts the MCP server over stdio. Use an MCP-compatible client (or the Inspector below) to connect.

### Run with MCP Inspector

The repo includes a helper script to launch the server in the MCP Inspector:

```bash
pnpm run server:inspect
```

Notes:

- On Windows, the script sets `DANGEROUSLY_OMIT_AUTH=true` for the Inspector session only.
- The script internally runs: `pnpm dlx @modelcontextprotocol/inspector pnpm dev`.

## Tool: `get_weather`

Retrieves weather for a given city.

**Input schema**

- `city` (string, required): City name to query (e.g., "San Francisco").
- `units` ("metric" | "imperial", optional, default: "metric").
- `mode` ("current" | "hourly" | "daily", optional, default: "current").
- `days` (int, optional): Only for `daily` mode; must be 7–10 (defaults to 7 if omitted).
- `format` ("json" | "text", optional, default: environment-dependent, see below).

**Response format**

- JSON by default. If `format: "text"` (or env var below is set), returns a single text blob containing stringified JSON for compatibility.

### Examples

Current conditions (metric):

```json
{
  "name": "get_weather",
  "arguments": { "city": "Tokyo" }
}
```

Hourly next ~24h (imperial):

```json
{
  "name": "get_weather",
  "arguments": { "city": "Seattle", "mode": "hourly", "units": "imperial" }
}
```

Daily 7–10 days (metric):

```json
{
  "name": "get_weather",
  "arguments": { "city": "Berlin", "mode": "daily", "days": 7 }
}
```

## Environment variables

- `MCP_TEXT_OUTPUT=1`

  - Forces text output (stringified JSON) for tool responses. Useful for clients that only display text.

- `DANGEROUSLY_OMIT_AUTH=true`
  - Only for local Inspector sessions (already set by `server:inspect` on Windows). Do not use in production.

## Scripts

- `pnpm dev` — Run the TypeScript server with `tsx` (`src/server.ts`).
- `pnpm build` — Type-check and emit JS via `tsc`.
- `pnpm run server:inspect` — Launch MCP Inspector pointed at `pnpm dev`.

## Project structure

- `src/server.ts` — MCP server entry point. Registers the `get_weather` tool and handles requests.
- `package.json` — Scripts and dependencies.
- `.env` — Optional environment overrides (e.g., `MCP_TEXT_OUTPUT=1`).

## Implementation details

- Geocoding uses Open‑Meteo Geocoding API (no API key).
- Forecast data retrieved via `openmeteo` SDK.
- Units supported:
  - Metric: °C for temperature, km/h for wind speed.
  - Imperial: °F for temperature, mph for wind speed.

## Build

```bash
pnpm build
```

## License

MIT
