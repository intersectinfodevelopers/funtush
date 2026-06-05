import { MongoClient, Db } from "mongodb";

const MONGO_URL = process.env.MONGO_URL ?? "mongodb://localhost:27017";
const DB_NAME = process.env.MONGO_DB ?? "funtush_logs";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(MONGO_URL, {
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();

  db = client.db(DB_NAME);

  console.log(`[MongoDB] Connected to ${DB_NAME}`);

  return db;
}

export async function closeMongo(): Promise<void> {
  if (!client) return;

  await client.close();

  client = null;
  db = null;
}