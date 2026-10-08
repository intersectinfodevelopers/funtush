import { httpError, fieldError } from "./httpError";

interface registrationInput {
  email: string;
  password: string;
  phone: string;
}

const DIFFICULTIES = ["EASY", "MODERATE", "CHALLENGING", "DIFFICULT"];

/** What the API tells a caller to send. The values are accepted in any letter case (see normalizeDifficulty). */
export const DIFFICULTY_MESSAGE = "Choose a difficulty: " + DIFFICULTIES.join(", ").toLowerCase() + ".";

/**
 * Canonical TrekDifficulty enum value for "moderate" / "Moderate" / "MODERATE", or null if it isn't one.
 * (BUG-202: the error message used to list lowercase values while only uppercase was accepted.)
 */
export const normalizeDifficulty = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const upper = v.trim().toUpperCase();
  return DIFFICULTIES.includes(upper) ? upper : null;
};

interface PackageInput {
  title: string;
  durationDays: number;
  pricePerPerson: number;
  difficulty: string;
  maxGroupSize: number;
}

export const validateRegistrationInput = (data: Partial<registrationInput>) => {
  const { email, password, phone } = data;

  // These come straight from a request body, so any of them can be missing or
  // the wrong type — without the typeof checks a missing `email` surfaced as a
  // TypeError ("Cannot read properties of undefined") and a 500. Every one of
  // these is the caller's mistake, so they carry a 400.
  if (typeof email !== "string" || !email.includes("@")) {
    throw httpError(400, "Invalid email format");
  }

  if (typeof password !== "string" || password.length < 8) {
    throw httpError(400, "Password must be at least 8 characters");
  }

  if (typeof phone !== "string" || !/^(98|97)\d{8}$/.test(phone)) {
    throw httpError(400, "Invalid phone format");
  }
};

/** Package photos: up to 8 http(s) URLs (uploaded via /upload); the first is the cover. */
export const parsePackagePhotos = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw fieldError("photos", "Photos must be a list of image URLs.");
  if (v.length > 5) throw fieldError("photos", "A package can have at most 5 photos.");
  return v.map((u) => {
    if (typeof u !== "string" || u.length > 500) throw fieldError("photos", "Each photo must be an image URL.");
    let ok = false;
    try { ok = ["http:", "https:"].includes(new URL(u).protocol); } catch { /* invalid */ }
    if (!ok) throw fieldError("photos", "Each photo must be an http(s) image URL.");
    return u;
  });
};

export const PACKAGE_CATEGORIES = ["Trekking", "Peak Climbing", "Cultural Tour", "Wildlife Safari", "Adventure Sports", "Pilgrimage", "Day Hike"] as const;
export const PACKAGE_CURRENCIES = ["NPR", "USD", "EUR", "GBP", "INR"] as const;

const optInt = (v: unknown, label: string, field: string, min = 0, max = 100000): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw fieldError(field, `${label} must be a whole number between ${min} and ${max}.`);
  return v;
};
const optText = (v: unknown, label: string, field: string, max: number): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw fieldError(field, `${label} must be text.`);
  const t = v.trim();
  if (t.length > max) throw fieldError(field, `${label} must be at most ${max} characters.`);
  return t === "" ? null : t;
};
const textList = (v: unknown, label: string, field: string): string[] => {
  if (!Array.isArray(v) || v.length > 20) throw fieldError(field, `${label} must be a list of at most 20 items.`);
  return [...new Set(v.map((x) => {
    if (typeof x !== "string" || x.trim().length === 0 || x.trim().length > 60) throw fieldError(field, `${label}: each item must be 1-60 characters.`);
    return x.trim();
  }))];
};

/** Volume-discount tiers: [{ minPeople >= 2, percentOff 1..90 }], strictly increasing in both. */
export const parseVolumeDiscounts = (v: unknown): { minPeople: number; percentOff: number }[] => {
  if (!Array.isArray(v) || v.length > 6) throw fieldError("volumeDiscounts", "Group discounts: at most 6 tiers.");
  const tiers = v.map((t) => {
    const o = t as { minPeople?: unknown; percentOff?: unknown };
    if (!Number.isInteger(o?.minPeople) || (o.minPeople as number) < 2 || (o.minPeople as number) > 1000) throw fieldError("volumeDiscounts", "Each discount tier needs a group size of 2 or more.");
    if (typeof o.percentOff !== "number" || !(o.percentOff > 0) || o.percentOff > 90) throw fieldError("volumeDiscounts", "Each discount must be between 0 and 90 percent.");
    return { minPeople: o.minPeople as number, percentOff: Math.round(o.percentOff * 100) / 100 };
  }).sort((a, b) => a.minPeople - b.minPeople);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minPeople === tiers[i - 1].minPeople) throw fieldError("volumeDiscounts", "Two discount tiers can't have the same group size.");
    if (tiers[i].percentOff <= tiers[i - 1].percentOff) throw fieldError("volumeDiscounts", "A bigger group must get a bigger discount.");
  }
  return tiers;
};

/** The price for `groupSize` people after the best matching volume tier. */
export const discountedPricePerPerson = (base: number, tiers: unknown, groupSize: number): number => {
  const list = Array.isArray(tiers) ? (tiers as { minPeople: number; percentOff: number }[]) : [];
  const hit = list.filter((t) => groupSize >= t.minPeople).sort((a, b) => b.percentOff - a.percentOff)[0];
  return hit ? Math.round(base * (1 - hit.percentOff / 100) * 100) / 100 : base;
};

/**
 * The optional "package builder" fields, validated and cleaned; only keys present in `data` are returned, so it works
 * for both create and partial update.
 */
export const parsePackageDetails = (data: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const has = (k: string) => data[k] !== undefined;
  if (has("destination")) out.destination = optText(data.destination, "Destination", "destination", 120);
  if (has("category")) {
    const c = optText(data.category, "Category", "category", 60);
    if (c !== null && !(PACKAGE_CATEGORIES as readonly string[]).includes(c)) throw fieldError("category", "Choose a category from the list.");
    out.category = c;
  }
  if (has("minDurationDays")) out.minDurationDays = optInt(data.minDurationDays, "Minimum duration", "minDurationDays", 1, 365);
  if (has("maxDurationDays")) out.maxDurationDays = optInt(data.maxDurationDays, "Maximum duration", "maxDurationDays", 1, 365);
  if (has("altitudeMinM")) out.altitudeMinM = optInt(data.altitudeMinM, "Minimum altitude", "altitudeMinM", 0, 9000);
  if (has("altitudeMaxM")) out.altitudeMaxM = optInt(data.altitudeMaxM, "Maximum altitude", "altitudeMaxM", 0, 9000);
  const lo = (out.minDurationDays ?? data.minDurationDays) as number | null | undefined, hi = (out.maxDurationDays ?? data.maxDurationDays) as number | null | undefined;
  if (typeof lo === "number" && typeof hi === "number" && lo > hi) throw fieldError("minDurationDays", "Minimum duration can't be more than the maximum.");
  const alo = out.altitudeMinM as number | null | undefined, ahi = out.altitudeMaxM as number | null | undefined;
  if (typeof alo === "number" && typeof ahi === "number" && alo > ahi) throw fieldError("altitudeMinM", "Minimum altitude can't be more than the maximum.");
  if (has("region")) out.region = optText(data.region, "Region", "region", 120);
  if (has("bestTimeToVisit")) out.bestTimeToVisit = optText(data.bestTimeToVisit, "Best time to visit", "bestTimeToVisit", 120);
  if (has("activities")) out.activities = textList(data.activities, "Activities", "activities");
  if (has("routes")) out.routes = textList(data.routes, "Routes", "routes");
  if (has("shortSummary")) out.shortSummary = optText(data.shortSummary, "Short summary", "shortSummary", 300);
  if (has("currency")) {
    if (typeof data.currency !== "string" || !(PACKAGE_CURRENCIES as readonly string[]).includes(data.currency)) throw fieldError("currency", "Choose a currency from the list.");
    out.currency = data.currency;
  }
  if (has("isFeatured")) {
    if (typeof data.isFeatured !== "boolean") throw fieldError("isFeatured", "Featured must be on or off.");
    out.isFeatured = data.isFeatured;
  }
  if (has("volumeDiscounts")) out.volumeDiscounts = parseVolumeDiscounts(data.volumeDiscounts);
  return out;
};

export const validatePackageInput = (data: PackageInput) => {
  if (typeof data.title !== "string" || !data.title.trim()) throw fieldError("title", "Title is required.");
  if (data.title.trim().length > 200) throw fieldError("title", "Title must be at most 200 characters.");
  if (!Number.isInteger(data.durationDays) || data.durationDays < 1)
    throw fieldError("durationDays", "Duration must be a whole number of days (1 or more).");
  if (typeof data.pricePerPerson !== "number" || !(data.pricePerPerson >= 0))
    throw fieldError("pricePerPerson", "Price is required and can't be negative.");
  const difficulty = normalizeDifficulty(data.difficulty);
  if (!difficulty) throw fieldError("difficulty", DIFFICULTY_MESSAGE);
  data.difficulty = difficulty; // the service stores exactly this value, so "moderate" and "MODERATE" both work
  if (!Number.isInteger(data.maxGroupSize) || data.maxGroupSize < 1)
    throw fieldError("maxGroupSize", "Max group size must be a whole number (1 or more).");
};

// ── Day 3: Itinerary Builder ─────────────────────────────────────────
interface ItineraryDayInput {
  dayNumber: number;
  location?: unknown;
  description?: unknown;
  altitudeM?: unknown;
  photos?: unknown;
}

// Shared field checks used by both add (POST) and update (PUT). On update the
// fields are optional, so each is only validated when present.
const validateItineraryFields = (data: Partial<ItineraryDayInput>) => {
  if (data.location !== undefined && typeof data.location !== "string")
    throw new Error("location must be a string");
  if (data.description !== undefined && typeof data.description !== "string")
    throw new Error("description must be a string");
  if (
    data.altitudeM !== undefined &&
    data.altitudeM !== null &&
    (!Number.isInteger(data.altitudeM) || (data.altitudeM as number) < 0)
  )
    throw new Error("altitudeM must be a non-negative integer");
  if (data.photos !== undefined) {
    if (!Array.isArray(data.photos) || data.photos.some((p) => typeof p !== "string"))
      throw new Error("photos must be an array of strings (URLs)");
  }
};

// POST body — dayNumber is required, everything else optional.
export const validateItineraryDayInput = (data: ItineraryDayInput) => {
  if (!Number.isInteger(data.dayNumber) || data.dayNumber < 1)
    throw new Error("dayNumber must be a positive integer");
  validateItineraryFields(data);
};

// PUT body — content fields only; dayNumber is taken from the URL, never the body
// (reordering is a separate endpoint).
export const validateItineraryUpdateInput = (data: Partial<ItineraryDayInput>) => {
  validateItineraryFields(data);
};

// ── Day 4: Departure Dates ───────────────────────────────────────────
const DEPARTURE_STATUSES = ["AVAILABLE", "FULL", "GUARANTEED"];

interface DepartureDateInput {
  startDate: unknown;
  maxSlots: unknown;
  status?: unknown;
}

// A startDate is valid only if it parses to a real date that isn't in the past
// (a departure you can no longer take bookings for shouldn't be created).
const parseStartDate = (raw: unknown): Date => {
  if (typeof raw !== "string" && !(raw instanceof Date)) {
    throw new Error("startDate is required (ISO date string)");
  }
  const date = new Date(raw as string);
  if (Number.isNaN(date.getTime())) throw new Error("startDate is not a valid date");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (date < todayStart) throw new Error("startDate cannot be in the past");
  return date;
};

// POST body — startDate + maxSlots required; status optional (defaults to AVAILABLE).
// Returns the parsed startDate so the caller doesn't re-parse it.
export const validateDepartureDateInput = (data: DepartureDateInput): { startDate: Date } => {
  const startDate = parseStartDate(data.startDate);
  if (!Number.isInteger(data.maxSlots) || (data.maxSlots as number) < 1)
    throw new Error("maxSlots must be a positive integer");
  if (data.status !== undefined && !DEPARTURE_STATUSES.includes(data.status as string))
    throw new Error("status must be one of: " + DEPARTURE_STATUSES.join(", "));
  return { startDate };
};

interface DepartureUpdateInput {
  startDate?: unknown;
  maxSlots?: unknown;
  status?: unknown;
}

// PATCH body — every field optional, but at least one must be present. Returns the
// parsed startDate when one was supplied so the caller doesn't re-parse it.
export const validateDepartureUpdateInput = (
  data: DepartureUpdateInput
): { startDate?: Date } => {
  if (data.startDate === undefined && data.maxSlots === undefined && data.status === undefined)
    throw new Error("Provide at least one of: startDate, maxSlots, status");

  let startDate: Date | undefined;
  if (data.startDate !== undefined) startDate = parseStartDate(data.startDate);
  if (data.maxSlots !== undefined && (!Number.isInteger(data.maxSlots) || (data.maxSlots as number) < 1))
    throw new Error("maxSlots must be a positive integer");
  if (data.status !== undefined && !DEPARTURE_STATUSES.includes(data.status as string))
    throw new Error("status must be one of: " + DEPARTURE_STATUSES.join(", "));

  return { startDate };
};
