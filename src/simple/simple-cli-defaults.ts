import type { Timeframe } from "../contracts/timeframe.js";
import { ALL_TIMEFRAMES } from "../contracts/timeframe.js";

export const ALL_SUPPORTED_TIMEFRAMES = [...ALL_TIMEFRAMES] as Timeframe[];

export function parseSimpleTimeframes(value: string | undefined): Timeframe[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const timeframes = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (timeframes.length === 0) {
    throw new Error("SIMPLE_TIMEFRAMES_EMPTY");
  }

  for (const timeframe of timeframes) {
    if (!(ALL_TIMEFRAMES as string[]).includes(timeframe)) {
      throw new Error(`SIMPLE_TIMEFRAME_INVALID:${timeframe}`);
    }
  }

  return timeframes as Timeframe[];
}

export function resolveCliDateRange(input: {
  from?: string;
  to?: string;
  days?: string;
}): { from?: string; to?: string; days?: number } {
  const days = input.days !== undefined ? parsePositiveInteger(input.days, "days") : undefined;

  if (input.from !== undefined) {
    return {
      from: input.from,
      to: input.to,
      days,
    };
  }

  if (days === undefined) {
    return {
      from: undefined,
      to: input.to,
      days: undefined,
    };
  }

  const to = input.to ?? new Date().toISOString();
  const toMs = Date.parse(normalizeCliDateForParse(to));

  if (!Number.isFinite(toMs)) {
    throw new Error(`SIMPLE_DATE_INVALID:${to}`);
  }

  const from = new Date(toMs - days * 24 * 60 * 60 * 1000).toISOString();

  return {
    from,
    to,
    days: undefined,
  };
}

export function inferDirectOutputPath(input: {
  chain?: string;
  pair?: string;
  pool?: string;
  from?: string;
  to?: string;
  days?: number;
}): string | undefined {
  if (input.chain === undefined) {
    return undefined;
  }

  const subject = input.pair !== undefined
    ? slugify(input.pair)
    : input.pool !== undefined
      ? input.pool.toLowerCase().slice(0, 10)
      : undefined;

  if (subject === undefined) {
    return undefined;
  }

  const fromPart = input.from !== undefined ? datePart(input.from) : undefined;
  const toPart = input.to !== undefined
    ? datePart(input.to)
    : input.days !== undefined
      ? `${input.days}d`
      : undefined;

  if (fromPart === undefined || toPart === undefined) {
    return `./out/dex/${input.chain}-${subject}`;
  }

  return `./out/dex/${input.chain}-${subject}-${fromPart}-${toPart}`;
}

export function inferSimpleDatasetId(input: {
  chain?: string;
  pair?: string;
  pool?: string;
  from?: string;
  to?: string;
}): string | undefined {
  if (input.chain === undefined || input.from === undefined || input.to === undefined) {
    return undefined;
  }

  const subject = input.pair !== undefined
    ? slugify(input.pair)
    : input.pool !== undefined
      ? input.pool.toLowerCase().slice(0, 10)
      : "dex-pools";

  return `${input.chain}-${subject}-${datePart(input.from)}-${datePart(input.to)}`;
}

function parsePositiveInteger(value: string, field: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`SIMPLE_INTEGER_INVALID:${field}:${value}`);
  }

  return parsed;
}

function normalizeCliDateForParse(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

function datePart(value: string): string {
  return value.slice(0, 10).replace(/[^0-9]/g, "");
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
