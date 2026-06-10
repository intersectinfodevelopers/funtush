
import { S3Client } from "@aws-sdk/client-s3";

export const storageClient = new S3Client({
    region: "auto",
    endpoint: process.env.STORAGE_ENDPOINT,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});
