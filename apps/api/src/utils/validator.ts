interface registrationInput {
  email: string;
  password: string;
  phone: string;
}

const DIFFICULTIES = ["EASY", "MODERATE", "CHALLENGING", "DIFFICULT"];

interface PackageInput {
  title: string;
  durationDays: number;
  pricePerPerson: number;
  difficulty: string;
  maxGroupSize: number;
}

export const validateRegistrationInput = (data: registrationInput) => {
  const { email, password, phone } = data;

  if (!email.includes("@")) {
    throw new Error("Invalid email format");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  if (!/^(98|97)\d{8}$/.test(phone)) {
    throw new Error("Invalid phone format");
  }
};

export const validatePackageInput = (data: PackageInput) => {
  if (!data.title?.trim()) throw new Error("title is required");
  if (!Number.isInteger(data.durationDays) || data.durationDays < 1)
    throw new Error("durationDays must be a positive integer");
  if (typeof data.pricePerPerson !== "number" || data.pricePerPerson < 0)
    throw new Error("pricePerPerson must be a non-negative number");
  if (!DIFFICULTIES.includes(data.difficulty))
    throw new Error("difficulty must be one of: " + DIFFICULTIES.join(", "));
  if (!Number.isInteger(data.maxGroupSize) || data.maxGroupSize < 1)
    throw new Error("maxGroupSize must be a positive integer");
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
