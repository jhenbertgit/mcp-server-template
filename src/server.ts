import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { fetchWeatherApi } from "openmeteo";
import { z } from "zod";
import * as http from "node:http";

// Basic MCP server template using stdio transport
async function main() {
  const server = new Server(
    { name: "local-mcp-server", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // Simple geocoding via Open-Meteo Geocoding API
  async function geocodeCity(name: string): Promise<{
    latitude: number;
    longitude: number;
    displayName: string;
  } | null> {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", name);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{
        latitude: number;
        longitude: number;
        name: string;
        country?: string;
        admin1?: string;
      }>;
    };
    const first = data.results?.[0];
    if (!first) return null;
    const parts = [first.name, first.admin1, first.country].filter(Boolean);
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      displayName: parts.join(", "),
    };
  }

  // Advertise available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_weather",
          description:
            "Get weather for a city. Provide 'city', optional 'units' (metric|imperial), and optional 'mode' ('current' | 'hourly' | 'daily'). For daily, you can also set 'days' (7-10).",
          inputSchema: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name to query" },
              units: {
                type: "string",
                description: "Units system (metric or imperial)",
                enum: ["metric", "imperial"],
              },
              mode: {
                type: "string",
                description:
                  "Data mode: 'current' (default), 'hourly' (next ~24h), or 'daily' (next 7-10 days)",
                enum: ["current", "hourly", "daily"],
              },
              days: {
                type: "number",
                description:
                  "For daily mode only: number of forecast days (7-10). Defaults to 7.",
                minimum: 1,
                maximum: 16,
              },
              format: {
                type: "string",
                description:
                  "Response format: 'json' (default) or 'text' (compat mode returning stringified JSON)",
                enum: ["json", "text"],
              },
            },
            required: ["city"],
          },
        },
      ],
    };
  });

  // Shared schema and tool implementation so both MCP and HTTP can use it
  const defaultFormat: "json" | "text" =
    process.env.MCP_TEXT_OUTPUT === "1" ? "text" : "json";

  const ArgSchema = z
    .object({
      city: z.string().trim().min(1, "city is required"),
      units: z.enum(["metric", "imperial"]).optional().default("metric"),
      mode: z
        .enum(["current", "hourly", "daily"])
        .optional()
        .default("current"),
      days: z.number().int().min(1).max(16).optional(),
      format: z.enum(["json", "text"]).optional().default(defaultFormat),
    })
    .superRefine((val, ctx) => {
      if (val.mode === "daily") {
        const d = val.days ?? 7;
        if (d < 7 || d > 10) {
          ctx.addIssue({
            code: "custom",
            path: ["days"],
            message: "days must be between 7 and 10 for daily mode",
          });
        }
      }
    });

  type ToolResult = {
    content:
      | [{ type: "text"; text: string }]
      | [{ type: "json"; json: unknown }];
    isError: boolean;
  };

  const wrap = (
    fmt: "json" | "text",
    payload: unknown
  ): [{ type: "text"; text: string }] | [{ type: "json"; json: unknown }] =>
    fmt === "text"
      ? ([{ type: "text", text: JSON.stringify(payload) }] as [
          {
            type: "text";
            text: string;
          }
        ])
      : ([{ type: "json", json: payload }] as [
          {
            type: "json";
            json: unknown;
          }
        ]);

  async function handleGetWeather(
    argsRaw: unknown,
    opts?: { onProgress?: (msg: string) => void }
  ): Promise<ToolResult> {
    // Validate and normalize arguments with Zod
    const parsed = ArgSchema.safeParse(argsRaw);
    if (!parsed.success) {
      return {
        content: wrap("json", {
          error: "invalid_arguments",
          issues: z.treeifyError(parsed.error),
        }),
        isError: true,
      };
    }

    const { city, units, mode, format } = parsed.data;
    const days =
      mode === "daily"
        ? Math.min(10, Math.max(7, parsed.data.days ?? 7))
        : undefined;

    try {
      opts?.onProgress?.(`geocoding:${city}`);
      const geo = await geocodeCity(city);
      if (!geo) {
        return {
          content: [
            { type: "text", text: `Could not find location for "${city}"` },
          ],
          isError: true,
        };
      }

      const params: Record<string, unknown> = {
        latitude: geo.latitude,
        longitude: geo.longitude,
        timezone: "auto",
      };
      if (mode === "current") {
        params["current"] = ["temperature_2m", "wind_speed_10m"];
      } else if (mode === "hourly") {
        params["hourly"] = ["temperature_2m", "wind_speed_10m"];
        params["past_days"] = 0;
        params["forecast_days"] = 2;
      } else if (mode === "daily") {
        params["daily"] = [
          "temperature_2m_max",
          "temperature_2m_min",
          "precipitation_sum",
          "wind_speed_10m_max",
        ];
        params["forecast_days"] = days ?? 7;
      }
      if (units === "imperial") {
        params["temperature_unit"] = "fahrenheit";
        params["windspeed_unit"] = "mph";
      } else {
        params["temperature_unit"] = "celsius";
        params["windspeed_unit"] = "kmh";
      }

      opts?.onProgress?.("fetching_forecast");
      const url = "https://api.open-meteo.com/v1/forecast";
      const responses = await fetchWeatherApi(url, params);
      const response = responses[0];
      if (!response) {
        return { content: wrap(format, { error: "no_data" }), isError: true };
      }

      const tempUnit = units === "imperial" ? "°F" : "°C";
      const windUnit = units === "imperial" ? "mph" : "km/h";

      opts?.onProgress?.("assembling_output");

      if (mode === "current") {
        const current = response.current();
        if (!current) {
          return {
            content: wrap(format, { error: "missing_current" }),
            isError: true,
          };
        }
        const temperature = current.variables(0)?.value();
        const windSpeed = current.variables(1)?.value();
        const t =
          typeof temperature === "number" && Number.isFinite(temperature)
            ? Number(temperature.toFixed(1))
            : null;
        const w =
          typeof windSpeed === "number" && Number.isFinite(windSpeed)
            ? Number(windSpeed.toFixed(1))
            : null;
        return {
          content: wrap(format, {
            location: geo.displayName,
            latitude: geo.latitude,
            longitude: geo.longitude,
            units,
            mode,
            current: {
              temperature: t,
              temperature_unit: tempUnit,
              wind_speed: w,
              wind_speed_unit: windUnit,
            },
          }),
          isError: false,
        };
      }

      if (mode === "hourly") {
        const hourly = response.hourly();
        if (!hourly) {
          return {
            content: wrap(format, { error: "missing_hourly" }),
            isError: true,
          };
        }
        const start = Number(hourly.time());
        const end = Number(hourly.timeEnd());
        const interval = hourly.interval();
        const count = (end - start) / interval;
        const times = Array.from(
          { length: count },
          (_, i) =>
            new Date(
              (start + i * interval + response.utcOffsetSeconds()) * 1000
            )
        );
        const temp = hourly.variables(0)?.valuesArray() ?? [];
        const wind = hourly.variables(1)?.valuesArray() ?? [];
        const max = Math.min(24, temp.length, wind.length, times.length);
        const items = Array.from({ length: max }, (_, i) => ({
          time_iso: times[i].toISOString(),
          temperature:
            typeof temp[i] === "number"
              ? Number(Number(temp[i]).toFixed(1))
              : null,
          temperature_unit: tempUnit,
          wind_speed:
            typeof wind[i] === "number"
              ? Number(Number(wind[i]).toFixed(1))
              : null,
          wind_speed_unit: windUnit,
        }));
        return {
          content: wrap(format, {
            location: geo.displayName,
            latitude: geo.latitude,
            longitude: geo.longitude,
            units,
            mode,
            hourly_next_24h: items,
          }),
          isError: false,
        };
      }

      // daily
      const daily = response.daily();
      if (!daily) {
        return {
          content: wrap(format, { error: "missing_daily" }),
          isError: true,
        };
      }
      const dStart = Number(daily.time());
      const dEnd = Number(daily.timeEnd());
      const dInterval = daily.interval();
      const dCount = (dEnd - dStart) / dInterval;
      const dTimes = Array.from(
        { length: dCount },
        (_, i) =>
          new Date(
            (dStart + i * dInterval + response.utcOffsetSeconds()) * 1000
          )
      );
      const tMax = daily.variables(0)?.valuesArray() ?? [];
      const tMin = daily.variables(1)?.valuesArray() ?? [];
      const precip = daily.variables(2)?.valuesArray() ?? [];
      const windMax = daily.variables(3)?.valuesArray() ?? [];
      const dMax = Math.min(
        tMax.length,
        tMin.length,
        precip.length,
        windMax.length,
        dTimes.length
      );
      const daysOut = Array.from({ length: dMax }, (_, i) => ({
        date: dTimes[i].toISOString().slice(0, 10),
        t_max:
          typeof tMax[i] === "number"
            ? Number(Number(tMax[i]).toFixed(1))
            : null,
        t_min:
          typeof tMin[i] === "number"
            ? Number(Number(tMin[i]).toFixed(1))
            : null,
        temperature_unit: tempUnit,
        precipitation_sum:
          typeof precip[i] === "number"
            ? Number(Number(precip[i]).toFixed(1))
            : null,
        precipitation_unit: "mm",
        wind_speed_10m_max:
          typeof windMax[i] === "number"
            ? Number(Number(windMax[i]).toFixed(1))
            : null,
        wind_speed_unit: windUnit,
      }));
      return {
        content: wrap(format, {
          location: geo.displayName,
          latitude: geo.latitude,
          longitude: geo.longitude,
          units,
          mode,
          days: days ?? null,
          daily: daysOut,
        }),
        isError: false,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text", text: `Failed to fetch weather: ${msg}` }],
        isError: true,
      };
    }
  }

  // Handle tool calls
  server.setRequestHandler(
    CallToolRequestSchema,
    async (req: CallToolRequest) => {
      const tool = req.params.name;
      const argsRaw = req.params.arguments ?? {};

      if (tool === "get_weather") {
        return handleGetWeather(argsRaw);
      }

      return {
        content: [{ type: "text", text: `Unknown tool: ${tool}` }],
        isError: true,
      };
    }
  );

  // Connect via stdio (compatible with MCP clients)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Lightweight HTTP server with JSON and SSE streaming support
  const port = Number(process.env.PORT ?? 3000);
  const sseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  } as const;

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Bad Request");
        return;
      }
      const urlObj = new URL(req.url, "http://localhost");
      const pathname = urlObj.pathname;

      // Health check
      if (req.method === "GET" && pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      // JSON non-stream endpoint: /get_weather?city=...&units=...&mode=...&days=...&format=...
      if (req.method === "GET" && pathname === "/get_weather") {
        const args = {
          city: urlObj.searchParams.get("city") ?? undefined,
          units: urlObj.searchParams.get("units") ?? undefined,
          mode: urlObj.searchParams.get("mode") ?? undefined,
          days: urlObj.searchParams.get("days")
            ? Number(urlObj.searchParams.get("days"))
            : undefined,
          format: urlObj.searchParams.get("format") ?? undefined,
        };
        const out = await handleGetWeather(args);
        const payload =
          out.content[0].type === "json"
            ? out.content[0].json
            : out.content[0].text;
        res.writeHead(out.isError ? 400 : 200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(
          typeof payload === "string" ? payload : JSON.stringify(payload)
        );
        return;
      }

      // SSE stream endpoint: /stream/get_weather?...
      if (req.method === "GET" && pathname === "/stream/get_weather") {
        res.writeHead(200, sseHeaders);
        const send = (event: string, data: unknown) => {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        send("ready", { ok: true });
        const args = {
          city:
            new URL(req.url, "http://localhost").searchParams.get("city") ??
            undefined,
          units:
            new URL(req.url, "http://localhost").searchParams.get("units") ??
            undefined,
          mode:
            new URL(req.url, "http://localhost").searchParams.get("mode") ??
            undefined,
          days: new URL(req.url, "http://localhost").searchParams.get("days")
            ? Number(
                new URL(req.url, "http://localhost").searchParams.get("days")
              )
            : undefined,
          format:
            new URL(req.url, "http://localhost").searchParams.get("format") ??
            undefined,
        };
        const out = await handleGetWeather(args, {
          onProgress: (msg) => send("progress", { message: msg }),
        });
        const payload =
          out.content[0].type === "json"
            ? out.content[0].json
            : out.content[0].text;
        send(out.isError ? "error" : "result", payload);
        res.end();
        return;
      }

      // Fallback
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "not_found" }));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "internal_error",
          message: (err as Error).message,
        })
      );
    }
  });

  httpServer.listen(port, () => {
    console.log(`HTTP server listening on http://localhost:${port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    try {
      await transport.close?.();
      httpServer.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});
