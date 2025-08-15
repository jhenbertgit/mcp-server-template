# Local MCP Server (Weather Tool)

A Model Context Protocol (MCP) server exposing a `get_weather` tool with multiple interfaces:
- MCP stdio protocol for MCP clients
- HTTP/JSON API endpoints
- Server-Sent Events (SSE) for streaming responses

## Features

- MCP stdio server implemented with `@modelcontextprotocol/sdk`
- HTTP server with JSON and SSE endpoints
- Weather tool: `get_weather` with current, hourly, and daily modes using Open‑Meteo
- Typed validation via `zod`
- Progress updates for long-running requests
- Health check endpoint

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

## Environment Variables

- `MCP_TEXT_OUTPUT=1`
  - Forces text output (stringified JSON) for tool responses. Useful for clients that only display text.

- `PORT=5000`
  - Port for the HTTP server (default: 5000)

- `DANGEROUSLY_OMIT_AUTH=true`
  - Only for local Inspector sessions (already set by `server:inspect` on Windows). Do not use in production.

## Scripts

- `pnpm dev` — Run the TypeScript server with `tsx` (`src/server.ts`).
- `pnpm build` — Type-check and emit JS via `tsc`.
- `pnpm run server:inspect` — Launch MCP Inspector pointed at `pnpm dev`.

## HTTP Endpoints

### GET /health
Health check endpoint. Returns `{ "status": "ok" }` when the server is running.

### GET /get_weather
Get weather data in JSON format.

**Query Parameters:**
- `city` (required): City name
- `units`: "metric" (default) or "imperial"
- `mode`: "current" (default), "hourly", or "daily"
- `days`: Number of days (7-10, required for "daily" mode)
- `format`: "json" (default) or "text"

### GET /stream/get_weather
Stream weather data with Server-Sent Events (SSE). Same parameters as `/get_weather`.

### POST /mcp
MCP protocol endpoint for programmatic access.

## Project Structure

- `src/server.ts` — MCP and HTTP server implementation
  - Handles MCP stdio protocol
  - Provides HTTP/JSON and SSE endpoints
  - Implements the weather service
- `package.json` — Scripts and dependencies
- `.env` — Optional environment overrides

## Implementation Details

- Geocoding uses Open‑Meteo Geocoding API (no API key)
- Forecast data retrieved via `openmeteo` SDK
- Implements MCP protocol over both stdio and HTTP
- Provides both JSON and text response formats
- Includes progress events for long-running requests
- Implements CORS for web access
- Validates all inputs with Zod

### Response Formats

#### Current Weather
```json
{
  "location": "City, Region, Country",
  "latitude": 0.0,
  "longitude": 0.0,
  "units": "metric",
  "mode": "current",
  "current": {
    "temperature": 20.5,
    "temperature_unit": "°C",
    "wind_speed": 15.3,
    "wind_speed_unit": "km/h"
  }
}
```

#### Hourly Forecast
```json
{
  "location": "City, Region, Country",
  "units": "metric",
  "mode": "hourly",
  "hourly_next_24h": [
    {
      "time_iso": "2023-01-01T00:00:00.000Z",
      "temperature": 18.5,
      "temperature_unit": "°C",
      "wind_speed": 12.3,
      "wind_speed_unit": "km/h"
    }
  ]
}
```

#### Daily Forecast
```json
{
  "location": "City, Region, Country",
  "units": "metric",
  "mode": "daily",
  "days": 7,
  "daily": [
    {
      "date": "2023-01-01",
      "t_max": 22.5,
      "t_min": 16.2,
      "temperature_unit": "°C",
      "precipitation_sum": 0.5,
      "precipitation_unit": "mm",
      "wind_speed_10m_max": 25.1,
      "wind_speed_unit": "km/h"
    }
  ]
}
```

### Units Supported
- **Metric**: °C for temperature, km/h for wind speed
- **Imperial**: °F for temperature, mph for wind speed

## Build

```bash
pnpm build
```

## License

MIT
