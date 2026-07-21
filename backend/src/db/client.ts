import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
  type PutCommandInput,
  type GetCommandInput,
  type UpdateCommandInput,
  type DeleteCommandInput,
  type QueryCommandInput,
  type ScanCommandInput,
  type BatchWriteCommandInput,
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
  INVENTORY_ITEMS: `${p()}_inventory_items`,
  ALERTS: `${p()}_alerts`,
  CREDIT_DEBIT_NOTES: `${p()}_credit_debit_notes`,
  PAYMENTS: `${p()}_payments`,
  CHART_OF_ACCOUNTS: `${p()}_chart_of_accounts`,
  JOURNAL_ENTRIES: `${p()}_journal_entries`,
  BALANCE_SHEET_ITEMS: `${p()}_balance_sheet_items`,
  COMPANIES: `${p()}_companies`,
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
  const items: T[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const params: ScanCommandInput = {
      TableName: tableName,
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      ...(options?.filterExpression ? { FilterExpression: options.filterExpression } : {}),
      ...(options?.expressionAttributeValues ? { ExpressionAttributeValues: options.expressionAttributeValues } : {}),
      ...(options?.expressionAttributeNames ? { ExpressionAttributeNames: options.expressionAttributeNames } : {}),
    };
    const result = await docClient.send(new ScanCommand(params));
    if (result.Items) {
      items.push(...(result.Items as T[]));
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

/**
 * Write multiple items to a DynamoDB table using BatchWriteCommand.
 * DynamoDB allows up to 25 items per batch request.
 * This function splits items into chunks of 25 and retries unprocessed items.
 */
export async function batchPutItems(
  tableName: string,
  items: Record<string, unknown>[],
  maxRetries = 3,
): Promise<void> {
  const chunkSize = 25;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    let retries = 0;
    let pendingItems = chunk;

    while (pendingItems.length > 0 && retries <= maxRetries) {
      const params: BatchWriteCommandInput = {
        RequestItems: {
          [tableName]: pendingItems.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      };

      const result = await docClient.send(new BatchWriteCommand(params));

      const unprocessed = result.UnprocessedItems?.[tableName];
      if (unprocessed && unprocessed.length > 0) {
        pendingItems = unprocessed.map((u) => u.PutRequest!.Item as Record<string, unknown>);
        retries++;
        // Exponential backoff
        if (retries <= maxRetries) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, retries)));
        }
      } else {
        pendingItems = [];
      }
    }
  }
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

/**
 * Delete multiple items from a DynamoDB table using BatchWriteCommand.
 * DynamoDB allows up to 25 delete requests per batch.
 */
export async function batchDeleteItems(
  tableName: string,
  keys: Record<string, unknown>[],
  maxRetries = 3,
): Promise<void> {
  const chunkSize = 25;

  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    let retries = 0;
    let pendingKeys = chunk;

    while (pendingKeys.length > 0 && retries <= maxRetries) {
      const params: BatchWriteCommandInput = {
        RequestItems: {
          [tableName]: pendingKeys.map((key) => ({
            DeleteRequest: { Key: key },
          })),
        },
      };

      const result = await docClient.send(new BatchWriteCommand(params));

      const unprocessed = result.UnprocessedItems?.[tableName];
      if (unprocessed && unprocessed.length > 0) {
        pendingKeys = unprocessed
          .map((u) => u.DeleteRequest?.Key)
          .filter((k): k is Record<string, unknown> => k != null);
        retries++;
        if (retries <= maxRetries) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, retries)));
        }
      } else {
        pendingKeys = [];
      }
    }
  }
}

export { docClient, DynamoDBClient };
