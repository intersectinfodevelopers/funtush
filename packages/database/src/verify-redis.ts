import "dotenv/config";
import { redis, setCache, getCache, deleteCache, checkRateLimit, setSession, getSession } from "./index";

async function main() {
  console.log("PING →", await redis.ping()); // expect "PONG"

  await setCache("demo", { hello: "funtush" }, 60);
  console.log("getCache →", await getCache("demo")); // { hello: "funtush" }
  await deleteCache("demo");
  console.log("after delete →", await getCache("demo")); // null

  console.log("rate 1 →", await checkRateLimit("1.2.3.4", 2, 60)); // true
  console.log("rate 2 →", await checkRateLimit("1.2.3.4", 2, 60)); // true
  console.log("rate 3 →", await checkRateLimit("1.2.3.4", 2, 60)); // false

  await setSession("user-42", { role: "agency_admin" });
  console.log("getSession →", await getSession("user-42")); // { role: "agency_admin" }

  await redis.quit();
}
main();
