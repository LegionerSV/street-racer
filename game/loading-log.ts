import type { Center } from './types';
export const LOADING_LOG_KEY = 'street-racer:loading-log:v1';
type Details = Record<string, string | number | boolean | undefined>;
type Status = 'running' | 'success' | 'error' | 'cancelled' | 'interrupted';
export type LoadingReport = {
  version: 1;
  startedAt: string;
  center: Center;
  quality: string;
  userAgent: string;
  status: Status;
  durationMs: number;
  error?: string;
  entries: {
    stage: string;
    startedMs: number;
    durationMs?: number;
    status: Status;
    details: Details;
  }[];
};
export class LoadingLog {
  private started = performance.now();
  private closed = false;
  readonly report: LoadingReport;
  constructor(center: Center, quality: string) {
    this.report = {
      version: 1,
      startedAt: new Date().toISOString(),
      center: { ...center },
      quality,
      userAgent:
        typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
      status: 'running',
      durationMs: 0,
      entries: [],
    };
    this.save();
  }
  snapshot(): LoadingReport {
    return structuredClone({
      ...this.report,
      durationMs: this.closed
        ? this.report.durationMs
        : Math.round(performance.now() - this.started),
    });
  }
  private save() {
    try {
      localStorage.setItem(LOADING_LOG_KEY, JSON.stringify(this.snapshot()));
    } catch {
      /* Диагностика не должна прерывать загрузку при запрете/переполнении хранилища. */
    }
  }
  start(stage: string, details: Details = {}) {
    const started = performance.now(),
      entry: LoadingReport['entries'][number] = {
        stage,
        startedMs: Math.round(started - this.started),
        status: 'running',
        details: { ...details },
      };
    if (!this.closed) {
      this.report.entries.push(entry);
      this.save();
    }
    let ended = false;
    return (status: Status = 'success', result: Details = {}) => {
      if (this.closed || ended) return;
      ended = true;
      entry.durationMs = Math.round(performance.now() - started);
      entry.status = status;
      Object.assign(entry.details, result);
      this.save();
    };
  }
  async measure<T>(
    stage: string,
    fn: () => T | Promise<T>,
    details: Details = {},
  ): Promise<T> {
    const end = this.start(stage, details);
    try {
      const value = await fn();
      end();
      return value;
    } catch (error) {
      end('error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  finish(status: Exclude<Status, 'running' | 'interrupted'>, error?: string) {
    if (this.closed) return;
    this.report.durationMs = Math.round(performance.now() - this.started);
    this.report.status = status;
    this.report.error = error;
    for (const entry of this.report.entries)
      if (entry.status === 'running') {
        entry.status = 'cancelled';
        entry.durationMs = this.report.durationMs - entry.startedMs;
      }
    this.closed = true;
    this.save();
  }
}
export function readLoadingLog(): LoadingReport | null {
  try {
    const log = JSON.parse(
      localStorage.getItem(LOADING_LOG_KEY) || 'null',
    ) as LoadingReport | null;
    if (log?.version !== 1 || !Array.isArray(log.entries)) return null;
    return {
      ...log,
      status: log.status === 'running' ? 'interrupted' : log.status,
    };
  } catch {
    return null;
  }
}
export function downloadLoadingLog(report: LoadingReport) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    ),
    link = document.createElement('a');
  link.href = url;
  link.download = `street-racer-loading-${report.startedAt.replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
