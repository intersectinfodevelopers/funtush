
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { storageClient } from "./client";
import { v4 as uuidv4 } from "uuid";
import path from "path";

export async function uploadFile(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname);
    const key = `uploads/${uuidv4()}${ext}`;

    await storageClient.send(
        new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME!,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        })
    );

    return `${process.env.CDN_BASE_URL}/${key}`;
}

export async function deleteFile(url: string): Promise<void> {
    const key = url.replace(`${process.env.CDN_BASE_URL}/`, "");

    await storageClient.send(
        new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME!,
            Key: key,
        })
    );
}
