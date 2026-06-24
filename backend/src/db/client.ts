import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  type PutCommandInput,
  type GetCommandInput,
  type UpdateCommandInput,
  type DeleteCommandInput,
  type QueryCommandInput,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { config } from "../config.js";

export const ddbClient = new DynamoDBClient({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
  endpoint: config.aws.dynamoDbEndpoint,
});

const docClient = DynamoDBDocumentClient.from(ddbClient);

// ── Table Names ──
const p = () => config.aws.tablePrefix;
export const TABLES = {
  USERS: `${p()}_users`,
  PROFILES: `${p()}_profiles`,
  USER_ROLES: `${p()}_user_roles`,
  DEBTORS: `${p()}_debtors`,
  VENDORS: `${p()}_vendors`,
  SUPPLIERS: `${p()}_suppliers`,
  INVOICES: `${p()}_invoices`,
  PURCHASE_INVOICES: `${p()}_purchase_invoices`,
  PURCHASE_ORDERS: `${p()}_purchase_orders`,
  ADVANCES: `${p()}_advances`,
  EXPENSES: `${p()}_expenses`,
  STOCK_MOVEMENTS: `${p()}_stock_movements`,
  ALERTS: `${p()}_alerts`,
  CREDIT_DEBIT_NOTES: `${p()}_credit_debit_notes`,
} as const;

// ── Generic helpers ──

export async function putItem(tableName: string, item: Record<string, unknown>) {
  const params: PutCommandInput = { TableName: tableName, Item: item };
  await docClient.send(new PutCommand(params));
  return item;
}

export async function getItem(tableName: string, key: Record<string, unknown>) {
  // Strip undefined/null values from the key to prevent DynamoDB
  // "The provided key element does not match the schema" error.
  // The AWS SDK strips undefined silently, turning { id: undefined } into {},
  // which DynamoDB rejects.
  const sanitizedKey: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(key)) {
    if (v !== undefined && v !== null) {
      sanitizedKey[k] = v;
    }
  }
  if (Object.keys(sanitizedKey).length === 0) {
    console.warn(`getItem called with empty/missing key for table ${tableName}`);
    return undefined;
  }
  const params: GetCommandInput = { TableName: tableName, Key: sanitizedKey };
  const result = await docClient.send(new GetCommand(params));
  return result.Item as Record<string, unknown> | undefined;
}

export async function updateItem(
  tableName: string,
  key: Record<string, unknown>,
  updates: Record<string, unknown>,
) {
  const updateExpression =
    "SET " +
    Object.keys(updates)
      .map((k) => `#${k} = :${k}`)
      .join(", ");
  const expressionAttributeNames = Object.fromEntries(
    Object.keys(updates).map((k) => [`#${k}`, k]),
  );
  const expressionAttributeValues = Object.fromEntries(
    Object.entries(updates).map(([k, v]) => [`:${k}`, v]),
  );

  const params: UpdateCommandInput = {
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "ALL_NEW",
  };
  const result = await docClient.send(new UpdateCommand(params));
  return result.Attributes as Record<string, unknown> | undefined;
}

export async function deleteItem(tableName: string, key: Record<string, unknown>) {
  const params: DeleteCommandInput = { TableName: tableName, Key: key };
  await docClient.send(new DeleteCommand(params));
}

export async function scanTable<T = Record<string, unknown>>(
  tableName: string,
  options?: { filterExpression?: string; expressionAttributeValues?: Record<string, unknown>; expressionAttributeNames?: Record<string, string> },
): Promise<T[]> {
  const params: ScanCommandInput = {
    TableName: tableName,
    ...(options?.filterExpression ? { FilterExpression: options.filterExpression } : {}),
    ...(options?.expressionAttributeValues ? { ExpressionAttributeValues: options.expressionAttributeValues } : {}),
    ...(options?.expressionAttributeNames ? { ExpressionAttributeNames: options.expressionAttributeNames } : {}),
  };
  const result = await docClient.send(new ScanCommand(params));
  return (result.Items ?? []) as T[];
}

export async function queryByIndex<T = Record<string, unknown>>(
  tableName: string,
  indexName: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, unknown>,
  scanIndexForward = false,
): Promise<T[]> {
  const params: QueryCommandInput = {
    TableName: tableName,
    IndexName: indexName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ScanIndexForward: scanIndexForward,
  };
  const result = await docClient.send(new QueryCommand(params));
  return (result.Items ?? []) as T[];
}

export { docClient, DynamoDBClient };
