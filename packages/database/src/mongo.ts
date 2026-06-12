import mongoose from "mongoose";

let isConnected = false;

export async function connectMongo(): Promise<void> {
  if (isConnected) return;

  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("MONGO_URL is not defined in environment variables");

  await mongoose.connect(uri);
  isConnected = true;
  console.log("MongoDB connected");
}

export { mongoose };