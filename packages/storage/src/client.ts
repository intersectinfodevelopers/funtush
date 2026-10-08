
import { S3Client } from "@aws-sdk/client-s3";

export const storageClient = new S3Client({
    region: "auto",
    endpoint: process.env.STORAGE_ENDPOINT,
    // Off by default. Set STORAGE_FORCE_PATH_STYLE=true for a custom/self-hosted endpoint (MinIO, a custom domain in
    // front of the bucket): otherwise the SDK prefixes the bucket name onto the host ("<bucket>.<endpoint>"), which does
    // not resolve there and surfaces as `getaddrinfo ENOTFOUND`.
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
});
