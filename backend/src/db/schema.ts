import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import { TABLES, ddbClient } from "./client.js";

const tableDefs = [
  {
    TableName: TABLES.USERS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.PROFILES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.USER_ROLES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.DEBTORS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.VENDORS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.SUPPLIERS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.INVOICES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "noa_token", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "noa_token-index",
        KeySchema: [{ AttributeName: "noa_token", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.PURCHASE_INVOICES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.PURCHASE_ORDERS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "po_number", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "po_number-index",
        KeySchema: [{ AttributeName: "po_number", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.ADVANCES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.EXPENSES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.STOCK_MOVEMENTS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.ALERTS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
] as const;

export async function createTables() {
  for (const table of tableDefs) {
    try {
      await ddbClient.send(new CreateTableCommand(table as any));
      console.log(`Created table: ${table.TableName}`);
    } catch (err: any) {
      if (err.name === "ResourceInUseException") {
        console.log(`Table already exists: ${table.TableName}`);
      } else {
        console.error(`Error creating table ${table.TableName}:`, err);
      }
    }
  }
}

// Run directly: npx tsx src/db/schema.ts
if (process.argv[1]?.endsWith("schema.ts") || process.argv[1]?.endsWith("schema.js")) {
  createTables().then(() => console.log("Done")).catch(console.error);
}
