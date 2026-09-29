import { redis } from "@funtush/database";

/**
 * Cron leader election. With more than one API process (cluster workers, or
 * several containers) every process schedules every job, so a nightly job
 * would run N times at the same instant. Each tick therefore first tries to
 * claim `job-lock:<name>` with SET NX EX; exactly one process wins and runs
 * the job, the rest skip.
 *
 * The lock is deliberately NOT released when the job finishes: processes tick
 * within milliseconds of each other, so a fast job could otherwise finish and
 * release before a slower process's tick — which would then run it again. The
 * TTL (longer than any clock skew, shorter than the schedule interval) is what
 * ends the claim.
 *
 * Fails open: if Redis is unreachable the job runs anyway. Every job here is
 * idempotent, and silently never running a nightly job is the worse failure.
 */
export async function acquireJobLock(name: string, ttlSeconds: number): Promise<boolean> {
  try {
    const won = await redis.set(`job-lock:${name}`, `${process.pid}`, "EX", ttlSeconds, "NX");
    return won === "OK";
  } catch (err) {
    console.warn(`[jobLock] Redis unavailable for "${name}" — running without a lock:`, err);
    return true;
  }
}
