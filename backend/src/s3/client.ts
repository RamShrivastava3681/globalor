import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

const s3Client = new S3Client({
  region: config.s3.bucketRegion,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

export async function uploadFile(
  key: string,
  body: Buffer | Uint8Array | Blob,
  contentType: string,
) {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await s3Client.send(command);
  return key;
}

export async function deleteFile(key: string) {
  const command = new DeleteObjectCommand({
    Bucket: config.s3.bucketName,
    Key: key,
  });
  await s3Client.send(command);
}

export async function getSignedDownloadUrl(key: string, expiresInSeconds = 60) {
  const command = new GetObjectCommand({
    Bucket: config.s3.bucketName,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export { s3Client };
