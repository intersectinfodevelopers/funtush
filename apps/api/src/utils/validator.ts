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
