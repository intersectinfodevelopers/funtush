
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { storageClient } from "./client";
import { v4 as uuidv4 } from "uuid";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local development without an object store: when STORAGE_ENDPOINT is unset (and NODE_ENV is not production) files are
 * written under `.local-uploads/` and the API serves them at CDN_BASE_URL (`/cdn`). Production uses the bucket — unless
 * STORAGE_DRIVER=local is set explicitly, which a staging/QA environment without an object store can opt into
 * (point CDN_BASE_URL at `<api-origin>/cdn` and keep LOCAL_UPLOAD_DIR on a mounted volume so files survive a redeploy).
 */
export const useLocalStorage = (): boolean =>
    process.env.STORAGE_DRIVER === "local" || (!process.env.STORAGE_ENDPOINT && process.env.NODE_ENV !== "production");
export const localUploadDir = (): string => path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), ".local-uploads"));
const localPath = (key: string): string => path.join(localUploadDir(), key);


/**
 * The multipart `Content-Type` and the filename are both chosen by the caller,
 * so neither is evidence of what the bytes are. Everything stored is therefore
 * (a) checked against its real magic bytes and (b) given an extension derived
 * from the DETECTED type — never from `originalname`, which let `evil.html`
 * be stored as-is under an `image/png` label.
 */
const SIGNATURES: { mime: string; ext: string; matches: (b: Buffer) => boolean }[] = [
    { mime: "image/jpeg", ext: ".jpg", matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    {
        mime: "image/png",
        ext: ".png",
        matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    },
    {
        mime: "image/webp",
        ext: ".webp",
        matches: (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
    },
    {
        mime: "image/gif",
        ext: ".gif",
        matches: (b) => b.length > 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a"),
    },
    { mime: "application/pdf", ext: ".pdf", matches: (b) => b.length > 5 && b.subarray(0, 5).toString("latin1") === "%PDF-" },
];

export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
    const hit = SIGNATURES.find((s) => s.matches(buffer));
    return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

export class UploadRejectedError extends Error {
    status = 400;
}

/** Owner ids go into an object key, so only a conservative charset is allowed. */
const SAFE_OWNER = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @param ownerId when given, the object is stored under `uploads/<ownerId>/…`,
 *   which is what later lets `deleteFile(url, { ownerId })` prove the caller
 *   owns it. Without it the key is `uploads/<uuid>.<ext>` and the API can never
 *   delete it on a caller's say-so.
 */
export async function uploadFile(file: Express.Multer.File, ownerId?: string): Promise<string> {
    const detected = detectFileType(file.buffer);
    if (!detected) {
        throw new UploadRejectedError("File content is not a valid jpg, png, webp, gif or pdf.");
    }
    if (ownerId !== undefined && !SAFE_OWNER.test(ownerId)) {
        throw new UploadRejectedError("Invalid upload owner.");
    }

    const key = ownerId
        ? `uploads/${ownerId}/${uuidv4()}${detected.ext}`
        : `uploads/${uuidv4()}${detected.ext}`;

    if (useLocalStorage()) {
        await mkdir(path.dirname(localPath(key)), { recursive: true });
        await writeFile(localPath(key), file.buffer);
        return `${process.env.CDN_BASE_URL}/${key}`;
    }

    await storageClient.send(
        new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME!,
            Key: key,
            Body: file.buffer,
            // The DETECTED type, not the claimed one.
            ContentType: detected.mime,
            ContentDisposition: "inline",
            // Belt and braces for a CDN that would otherwise sniff.
            CacheControl: "public, max-age=31536000, immutable",
        })
    );

    return `${process.env.CDN_BASE_URL}/${key}`;
}

/**
 * Resolves a CDN URL to its object key, or `null` if it isn't a plain upload
 * key. The old version was `url.replace(CDN_BASE_URL + "/", "")` — any string
 * that didn't start with the CDN base was used AS the key, so a caller could
 * name any object in the bucket.
 */
export function keyFromUrl(url: unknown): string | null {
    if (typeof url !== "string" || !process.env.CDN_BASE_URL) return null;
    const prefix = `${process.env.CDN_BASE_URL}/`;
    if (!url.startsWith(prefix)) return null;
    const key = url.slice(prefix.length);
    if (!key.startsWith("uploads/")) return null;
    if (key.includes("..") || key.includes("\\") || key.includes("%") || key.includes("?") || key.includes("#")) return null;
    if (!/^[A-Za-z0-9/_.-]+$/.test(key)) return null;
    return key;
}

/**
 * @param opts.ownerId when set, the object must live under `uploads/<ownerId>/`
 *   — i.e. it must have been uploaded by that owner. Every user-facing delete
 *   must pass this; omit it only for keys the server itself read from its own
 *   database (e.g. replacing an agency's stored logo).
 * @returns false (and deletes nothing) if the URL isn't a valid, owned upload.
 */
export async function deleteFile(url: string, opts: { ownerId?: string } = {}): Promise<boolean> {
    const key = keyFromUrl(url);
    if (!key) return false;
    if (opts.ownerId !== undefined) {
        if (!SAFE_OWNER.test(opts.ownerId) || !key.startsWith(`uploads/${opts.ownerId}/`)) return false;
    }

    if (useLocalStorage()) {
        await rm(localPath(key), { force: true });
        return true;
    }

    await storageClient.send(
        new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME!,
            Key: key,
        })
    );
    return true;
}
