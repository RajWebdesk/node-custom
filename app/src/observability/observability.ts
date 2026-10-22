import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Observability for the API (spec G5.5, profile "operations": structured JSON logs with redaction; exported metrics).
// Logs carry the route pattern, never the URL, query string, headers, cookies, or bodies.

export type LogLine = Record<string, string | number | boolean | null>;

export interface Logger {
  log(line: LogLine): void;
}

export const consoleLogger: Logger = {
  log: (line) => {
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...line })}\n`);
  },
};

// Request ids are safe to echo back: short, alphanumeric, and generated here unless the caller supplies a clean one.
const CLEAN_ID = /^[A-Za-z0-9-]{8,64}$/;

// Duration buckets in milliseconds. The pilot target is p95 under 1000 ms (provisional, 2026-10-21), so the
// 1000 ms bound must exist for the p95 to be estimated from the buckets.
export const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000] as const;

export class Metrics {
  private readonly counts = new Map<string, number>();
  private readonly durationSum = new Map<string, number>();
  private readonly buckets = new Map<string, number[]>();

  record(method: string, route: string, status: number, durationMs: number): void {
    const key = `${method} ${route} ${status}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.durationSum.set(key, (this.durationSum.get(key) ?? 0) + durationMs);
    const counts = this.buckets.get(key) ?? DURATION_BUCKETS_MS.map(() => 0);
    DURATION_BUCKETS_MS.forEach((bound, i) => {
      if (durationMs <= bound) counts[i] += 1;
    });
    this.buckets.set(key, counts);
  }

  // Prometheus text format. Labels hold only method, route pattern, and status.
  render(): string {
    const lines = [
      "# HELP http_requests_total Requests handled, by method, route pattern, and status.",
      "# TYPE http_requests_total counter",
    ];
    for (const [key, value] of this.counts) {
      const [method, route, status] = key.split(" ");
      lines.push(`http_requests_total{method="${method}",route="${route}",status="${status}"} ${value}`);
    }
    lines.push("# HELP http_request_duration_ms_sum Total request time in milliseconds.", "# TYPE http_request_duration_ms_sum counter");
    for (const [key, value] of this.durationSum) {
      const [method, route, status] = key.split(" ");
      lines.push(`http_request_duration_ms_sum{method="${method}",route="${route}",status="${status}"} ${value.toFixed(1)}`);
    }
    lines.push("# HELP http_request_duration_ms Request duration histogram in milliseconds.", "# TYPE http_request_duration_ms histogram");
    for (const [key, counts] of this.buckets) {
      const [method, route, status] = key.split(" ");
      const labels = `method="${method}",route="${route}",status="${status}"`;
      DURATION_BUCKETS_MS.forEach((bound, i) => lines.push(`http_request_duration_ms_bucket{${labels},le="${bound}"} ${counts[i]}`));
      lines.push(`http_request_duration_ms_bucket{${labels},le="+Inf"} ${this.counts.get(key) ?? 0}`);
      lines.push(`http_request_duration_ms_count{${labels}} ${this.counts.get(key) ?? 0}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

export function requestObserver(logger: Logger, metrics: Metrics) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header("x-request-id");
    const requestId = incoming && CLEAN_ID.test(incoming) ? incoming : randomBytes(12).toString("hex");
    res.setHeader("X-Request-Id", requestId);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      // Unmatched paths are logged as "unmatched" so that IDs and arbitrary paths never reach the log.
      const route = req.route ? `${req.baseUrl ?? ""}${req.route.path}` : "unmatched";
      metrics.record(req.method, route, res.statusCode, durationMs);
      logger.log({
        level: res.statusCode >= 500 ? "error" : "info",
        msg: "http_request",
        request_id: requestId,
        method: req.method,
        route,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}

// Readiness check result. Details never leave the server; the response carries only the status.
export async function withTimeout(check: () => Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Used when NODE_ENV is test, so test output stays readable.
export const silentLogger: Logger = { log: () => undefined };
