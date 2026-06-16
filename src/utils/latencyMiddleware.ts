import { Request, Response, NextFunction } from 'express';

const latencies: number[] = [];
const MAX_HISTORY = 1000;

export default function latencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  const originalJson = res.json;
  res.json = function (body: any) {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    res.setHeader('X-Response-Time', durationMs.toFixed(2) + 'ms');
    
    latencies.push(durationMs);
    if (latencies.length > MAX_HISTORY) {
      latencies.shift();
    }
    return originalJson.call(this, body);
  };

  next();
}

export function getLatencyStats(): { p50: number; p95: number; p99: number; count: number } {
  if (latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0, count: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  
  const getPercentile = (p: number) => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return Number(sorted[Math.max(0, index)].toFixed(2));
  };

  return {
    p50: getPercentile(50),
    p95: getPercentile(95),
    p99: getPercentile(99),
    count: latencies.length
  };
}
