import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  PutObjectCommand: class { constructor(public input: unknown) {} },
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
  S3Client: class { send = send; },
}));
vi.mock("../../../../packages/storage/src/client", () => ({ storageClient: { send: (...a: unknown[]) => send(...a) } }));

process.env.CDN_BASE_URL = "https://cdn.example.com";
process.env.AWS_BUCKET_NAME = "bucket";
process.env.STORAGE_ENDPOINT = "https://storage.example.com"; // bucket mode (without it, dev mode writes to local disk)

import { uploadFile, deleteFile, keyFromUrl, detectFileType, UploadRejectedError } from "../../../../packages/storage/src/uploader";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const file = (buffer: Buffer, originalname = "x.png", mimetype = "image/png") =>
  ({ buffer, originalname, mimetype }) as unknown as Express.Multer.File;

beforeEach(() => send.mockReset());

describe("uploadFile", () => {
  it("rejects HTML/SVG/script bytes even when labelled image/png with a .png name", async () => {
    for (const body of ["<html><script>alert(1)</script></html>", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "<?php system($_GET[0]); ?>"]) {
      await expect(uploadFile(file(Buffer.from(body)))).rejects.toBeInstanceOf(UploadRejectedError);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("derives extension + ContentType from the bytes, not the client's filename/mimetype", async () => {
    await uploadFile(file(PNG, "evil.html", "image/png"), "user-1");
    const input = (send.mock.calls[0][0] as { input: { Key: string; ContentType: string } }).input;
    expect(input.Key).toMatch(/^uploads\/user-1\/[0-9a-f-]{36}\.png$/);
    expect(input.ContentType).toBe("image/png");
  });

  it("refuses an owner id that could alter the key path", async () => {
    await expect(uploadFile(file(PNG), "../other")).rejects.toBeInstanceOf(UploadRejectedError);
    await expect(uploadFile(file(PNG), "a/b")).rejects.toBeInstanceOf(UploadRejectedError);
  });

  it("recognises jpeg, webp and pdf", () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))?.mime).toBe("image/jpeg");
    expect(detectFileType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))?.mime).toBe("image/webp");
    expect(detectFileType(Buffer.from("%PDF-1.7\n"))?.mime).toBe("application/pdf");
  });
});

describe("deleteFile / keyFromUrl", () => {
  const own = "https://cdn.example.com/uploads/user-1/abc.png";

  it("deletes the caller's own upload", async () => {
    expect(await deleteFile(own, { ownerId: "user-1" })).toBe(true);
    expect((send.mock.calls[0][0] as { input: { Key: string } }).input.Key).toBe("uploads/user-1/abc.png");
  });

  it("will not delete another user's upload", async () => {
    expect(await deleteFile("https://cdn.example.com/uploads/victim/abc.png", { ownerId: "user-1" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("will not delete an un-owned (legacy/server) key on a user's say-so", async () => {
    expect(await deleteFile("https://cdn.example.com/uploads/abc.png", { ownerId: "user-1" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects arbitrary bucket keys and traversal", async () => {
    for (const u of [
      "kyc/secret.pdf",
      "https://cdn.example.com/kyc/secret.pdf",
      "https://cdn.example.com/uploads/user-1/../victim/a.png",
      "https://cdn.example.com/uploads/user-1/%2e%2e/victim/a.png",
      "https://evil.example.com/uploads/user-1/a.png",
      "https://cdn.example.com/uploads/user-1/a.png?x=1",
    ]) {
      expect(await deleteFile(u, { ownerId: "user-1" })).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("keyFromUrl handles non-strings", () => {
    expect(keyFromUrl({ a: 1 })).toBeNull();
    expect(keyFromUrl(undefined)).toBeNull();
  });
});

describe("gif support", () => {
  it("accepts a real GIF (both signatures), rejects text labelled as a gif", async () => {
    for (const sig of ["GIF87a", "GIF89a"]) {
      const gif = Buffer.concat([Buffer.from(sig, "latin1"), Buffer.alloc(32)]);
      expect(detectFileType(gif)).toEqual({ mime: "image/gif", ext: ".gif" });
      send.mockResolvedValue({});
      const url = await uploadFile(file(gif, "anim.gif", "image/gif"));
      expect(url).toMatch(/\.gif$/);
    }
    await expect(uploadFile(file(Buffer.from("GIF89 not really"), "x.gif", "image/gif"))).rejects.toBeInstanceOf(UploadRejectedError);
  });
});

describe("local dev storage (no STORAGE_ENDPOINT, not production)", () => {
  it("writes to disk instead of the bucket, and deletes from disk", async () => {
    const { mkdtemp, readFile, access } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(os.tmpdir(), "funtush-up-"));
    const saved = { e: process.env.STORAGE_ENDPOINT, d: process.env.LOCAL_UPLOAD_DIR, n: process.env.NODE_ENV };
    delete process.env.STORAGE_ENDPOINT; process.env.LOCAL_UPLOAD_DIR = dir; process.env.NODE_ENV = "development";
    try {
      const url = await uploadFile(file(PNG), "owner-1");
      expect(url).toMatch(/^https:\/\/cdn\.example\.com\/uploads\/owner-1\/[0-9a-f-]+\.png$/);
      expect(send).not.toHaveBeenCalled();
      const key = url.replace("https://cdn.example.com/", "");
      expect((await readFile(path.join(dir, key))).equals(PNG)).toBe(true);
      expect(await deleteFile(url, { ownerId: "someone-else" })).toBe(false);
      expect(await deleteFile(url, { ownerId: "owner-1" })).toBe(true);
      await expect(access(path.join(dir, key))).rejects.toThrow();
      // production never falls back to disk
      process.env.NODE_ENV = "production";
      await expect(uploadFile(file(PNG))).resolves.toContain("uploads/");
      expect(send).toHaveBeenCalled();
    } finally {
      if (saved.e === undefined) delete process.env.STORAGE_ENDPOINT; else process.env.STORAGE_ENDPOINT = saved.e;
      if (saved.d === undefined) delete process.env.LOCAL_UPLOAD_DIR; else process.env.LOCAL_UPLOAD_DIR = saved.d;
      process.env.NODE_ENV = saved.n;
    }
  });
});
