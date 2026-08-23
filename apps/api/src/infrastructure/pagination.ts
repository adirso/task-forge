import { ValidationError } from "../application/errors.js";
import type { Page, PageRequest } from "../application/models.js";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export function pageRequest(input: { cursor?: string; limit?: string | number }, fallback = DEFAULT_PAGE_LIMIT, maximum = MAX_PAGE_LIMIT): PageRequest {
  const requested = input.limit === undefined ? fallback : Number(input.limit);
  if (!Number.isInteger(requested) || requested < 1 || requested > maximum) {
    throw new ValidationError(`limit must be an integer between 1 and ${maximum}`);
  }
  return { limit: requested, ...(input.cursor ? { cursor: input.cursor } : {}) };
}

export function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined, size: number): unknown[] | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== size || parsed.some((value) => typeof value !== "string" && typeof value !== "number")) throw new Error();
    return parsed;
  } catch {
    throw new ValidationError("Invalid pagination cursor; restart from the first page");
  }
}

export function toPage<T>(rows: T[], request: PageRequest, cursorValues: (item: T) => unknown[]): Page<T> {
  const hasMore = rows.length > request.limit;
  const items = hasMore ? rows.slice(0, request.limit) : rows;
  return {
    items,
    page: {
      limit: request.limit,
      hasMore,
      nextCursor: hasMore && items.length ? encodeCursor(cursorValues(items[items.length - 1]!)) : null,
    },
  };
}
