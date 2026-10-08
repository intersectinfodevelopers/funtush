import { Request, Response } from "express";
import { uploadFile, deleteFile, UploadRejectedError } from "@funtush/storage";

/**
 * Uploads are stored under `uploads/<userId>/…` so that a later delete can prove
 * the caller is the uploader. Before this, DELETE /upload took any URL and removed
 * that object — any signed-in user (a free trekker included) could delete another
 * agency's logo, package photos or KYC documents.
 */
function callerId(req: Request): string | null {
  const id = req.user?.userId;
  return typeof id === "string" && id ? id : null;
}

/** `?maxMb=3` lets a caller (package / destination photos) enforce a stricter limit than the global 10 MB. */
function tooLarge(req: Request, size: number): string | null {
  const mb = Number(req.query.maxMb);
  if (!Number.isFinite(mb) || mb <= 0 || mb >= 10) return null;
  return size >= mb * 1024 * 1024 ? `Photos must be smaller than ${mb} MB.` : null;
}

const STORAGE_UNREACHABLE = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "TimeoutError",
  "CredentialsProviderError",
]);

/**
 * The object store can't be reached or isn't configured (DNS failure, refused connection, timeout, missing
 * credentials). That is a server-side outage, so it is reported as 503 with a plain message — not an opaque 500.
 * (BUG-201: `getaddrinfo ENOTFOUND` from a misconfigured STORAGE_ENDPOINT came back as a bare 500.)
 */
export function isStorageUnreachable(err: unknown): boolean {
  const e = err as { code?: string; name?: string; cause?: { code?: string } } | null;
  if (!e || typeof e !== "object") return false;
  return [e.code, e.cause?.code, e.name].some((v) => typeof v === "string" && STORAGE_UNREACHABLE.has(v));
}

function storageUnavailable(res: Response, err: unknown) {
  const e = err as { code?: string; name?: string } | null;
  // Log only the error code — the full error can contain the configured endpoint host.
  console.error("[upload] object storage unreachable:", e?.code ?? e?.name ?? "unknown");
  return res.status(503).json({ error: "File storage is temporarily unavailable. Please try again later." });
}

export async function uploadSingle(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }
  const big = tooLarge(req, req.file.size);
  if (big) return res.status(400).json({ error: big });
  try {
    const url = await uploadFile(req.file, callerId(req) ?? undefined);
    return res.status(200).json({ url });
  } catch (err) {
    if (err instanceof UploadRejectedError) return res.status(400).json({ error: err.message });
    if (isStorageUnreachable(err)) return storageUnavailable(res, err);
    throw err;
  }
}

export async function uploadMultiple(req: Request, res: Response) {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }
  try {
    const owner = callerId(req) ?? undefined;
    const urls = await Promise.all(files.map((f) => uploadFile(f, owner)));
    return res.status(200).json({ urls });
  } catch (err) {
    if (err instanceof UploadRejectedError) return res.status(400).json({ error: err.message });
    if (isStorageUnreachable(err)) return storageUnavailable(res, err);
    throw err;
  }
}

export async function deleteUpload(req: Request, res: Response) {
  const url = req.body?.url;
  const owner = callerId(req);
  if (typeof url !== "string" || !url) {
    return res.status(400).json({ error: "URL is required" });
  }
  // Same response whether the object is someone else's, malformed, or missing —
  // don't let this endpoint be used to probe which keys exist.
  if (!owner || !(await deleteFile(url, { ownerId: owner }))) {
    return res.status(404).json({ error: "File not found" });
  }
  return res.status(200).json({ message: "File deleted" });
}
