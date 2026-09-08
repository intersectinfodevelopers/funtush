import mongoose from "mongoose";

// mongoose bundles the mongodb driver and re-exports its types under `mongo`.
// Importing "mongodb" directly is not resolvable from this package.
export type Db = mongoose.mongo.Db;

let isConnected = false;

export async function connectMongo(): Promise<Db> {
  if (isConnected && mongoose.connection.db) {
    return mongoose.connection.db;
  }

  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not defined in environment variables");

  await mongoose.connect(uri);
  isConnected = true;

  const mongoDb = mongoose.connection.db;
  if (!mongoDb) {
    throw new Error("MongoDB connection is not ready after connect");
  }

  console.log("MongoDB connected");
  return mongoDb;
}

export { mongoose };