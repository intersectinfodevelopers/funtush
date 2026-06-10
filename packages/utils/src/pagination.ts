// Translates page/limit query params into Prisma's skip/take arguments.

export interface PaginationParams {
  skip: number;
  take: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Convert a 1-based page number and page size into Prisma's { skip, take }.
 * Clamps to safe bounds so a bad query string can't request a huge page or
 * a negative offset.
 */
export function paginate(page = DEFAULT_PAGE, limit = DEFAULT_LIMIT): PaginationParams {
  const safePage = Math.max(1, Math.floor(page) || DEFAULT_PAGE);
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit) || DEFAULT_LIMIT));
  return {
    skip: (safePage - 1) * safeLimit,
    take: safeLimit,
  };
}
