import { Request, Response } from "express";
import { uploadFile, deleteFile } from "@funtush/storage";

export async function uploadSingle(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }
  const url = await uploadFile(req.file);
  return res.status(200).json({ url });
}

export async function uploadMultiple(req: Request, res: Response) {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }
  const urls = await Promise.all(files.map(uploadFile));
  return res.status(200).json({ urls });
}

export async function deleteUpload(req: Request, res: Response) {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }
  await deleteFile(url);
  return res.status(200).json({ message: "File deleted" });
}
