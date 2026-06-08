// Standard API response shapes. Framework-agnostic on purpose: these return
// plain objects. The caller passes them to res.json() and sets the HTTP status.

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code: number;
  };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: PaginationMeta;
}

/** Wrap a successful result. */
export function success<T>(data: T): SuccessResponse<T> {
  return { success: true, data };
}

/** Wrap an error with a message and an HTTP-style status code. */
export function error(message: string, code: number): ErrorResponse {
  return { success: false, error: { message, code } };
}

/** Wrap a paginated list together with its pagination metadata. */
export function paginated<T>(data: T[], meta: PaginationMeta): PaginatedResponse<T> {
  return { success: true, data, meta };
}
