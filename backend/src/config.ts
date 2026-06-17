import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  appUrl: process.env.APP_URL || "http://localhost:5173",

  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-do-not-use-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },

  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    dynamoDbEndpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    tablePrefix: process.env.DYNAMODB_TABLE_PREFIX || "ledger",
  },

  s3: {
    bucketName: process.env.S3_BUCKET_NAME || "ledger-documents",
    bucketRegion: process.env.S3_BUCKET_REGION || "us-east-1",
  },

  admin: {
    email: process.env.ADMIN_EMAIL || "",
    password: process.env.ADMIN_PASSWORD || "",
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromName: process.env.SMTP_FROM_NAME || "Insight Factor",
    fromEmail: process.env.SMTP_FROM_EMAIL || "",
  },
};
