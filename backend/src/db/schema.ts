import { CreateTableCommand, UpdateTimeToLiveCommand } from "@aws-sdk/client-dynamodb";
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
    TableName: TABLES.CUSTOMERS,
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
    TableName: TABLES.INVENTORY_ITEMS,
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
  {
    TableName: TABLES.CREDIT_DEBIT_NOTES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.PAYMENTS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.CHART_OF_ACCOUNTS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.JOURNAL_ENTRIES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.BALANCE_SHEET_ITEMS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "section", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "section-index",
        KeySchema: [{ AttributeName: "section", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.COMPANIES,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "name", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "name-index",
        KeySchema: [{ AttributeName: "name", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.PRODUCTS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.CATALOGUE_SETTINGS,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    // ── SKU hierarchy: master product + its colour/size variants ──
    //
    // Design for future extension without redesign:
    //   MASTER PRODUCT (product_type = MASTER)
    //   └─ MASTER-SKU (parentProductId = master id)
    //        ├─ MASTER-SKU-COLOUR
    //        │    └─ MASTER-SKU-COLOUR-SIZE (future)
    //        └─ MASTER-SKU-SIZE (future)
    //
    // Index strategy so that "colour under a master" and "all variants of a
    // master" are queryable directly (no full table scans):
    //   - `id` hash key: unique variant id
    //   - `masterSku` range key: SKUs sharing the same master are ordered
    //     (e.g. AD-M-TS-001, AD-M-TS-001-BLK, AD-M-TS-001-WHT).
    //   - `parentId-index`: all variants (including the master) for a parent.
    //   - `parentSku-index`: variants filtered by master SKU value.
    TableName: TABLES.PRODUCT_SKUS,
    KeySchema: [
      { AttributeName: "id", KeyType: "HASH" },
      { AttributeName: "masterSku", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "id", AttributeType: "S" },
      { AttributeName: "masterSku", AttributeType: "S" },
      { AttributeName: "parentId", AttributeType: "S" },
      { AttributeName: "parentSku", AttributeType: "S" },
      { AttributeName: "company_id", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "parentId-index",
        KeySchema: [{ AttributeName: "parentId", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "parentSku-index",
        KeySchema: [{ AttributeName: "parentSku", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
      {
        IndexName: "companyId-index",
        KeySchema: [{ AttributeName: "company_id", KeyType: "HASH" }],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
  },
  {
    TableName: TABLES.WORKFLOW_TASKS,
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

  // Enable TTL on the email registry so abandoned signup reservations
  // expire automatically. Successful signups set a far-future TTL on their
  // entry, so real index entries are never purged.
  try {
    await ddbClient.send(
      new UpdateTimeToLiveCommand({
        TableName: TABLES.EMAIL_REGISTRY,
        TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
      }),
    );
    console.log(`Enabled TTL on ${TABLES.EMAIL_REGISTRY}`);
  } catch (err: any) {
    console.log(`TTL status for ${TABLES.EMAIL_REGISTRY}: ${err.message}`);
  }
}

// Run directly: npx tsx src/db/schema.ts
if (process.argv[1]?.endsWith("schema.ts") || process.argv[1]?.endsWith("schema.js")) {
  createTables().then(() => console.log("Done")).catch(console.error);
}
