import { describe, expect, it } from "vitest";
import {
  validateRegistrationInput,
  validateItineraryDayInput,
  validateItineraryUpdateInput,
} from "./validator";

const valid = { email: "agency@example.com", password: "supersecret", phone: "9812345678" };

describe("validateRegistrationInput", () => {
  it("accepts a well-formed agency input", () => {
    expect(() => validateRegistrationInput(valid)).not.toThrow();
  });

  it("rejects an email without an @", () => {
    expect(() => validateRegistrationInput({ ...valid, email: "invalid" })).toThrow("Invalid email format");
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(() => validateRegistrationInput({ ...valid, password: "short" })).toThrow(
      "Password must be at least 8 characters",
    );
  });

  it("rejects a phone that is not a 10-digit 98/97 number", () => {
    expect(() => validateRegistrationInput({ ...valid, phone: "1234567890" })).toThrow("Invalid phone format");
    expect(() => validateRegistrationInput({ ...valid, phone: "981234567" })).toThrow("Invalid phone format");
  });
});

describe("validateItineraryDayInput", () => {
  const valid = {
    dayNumber: 1,
    location: "Lukla",
    description: "Fly to Lukla, trek to Phakding",
    altitudeM: 2860,
    photos: ["https://cdn/x.webp"],
  };

  it("accepts a well-formed itinerary day", () => {
    expect(() => validateItineraryDayInput(valid)).not.toThrow();
  });

  it("accepts a day with only dayNumber (other fields optional)", () => {
    expect(() => validateItineraryDayInput({ dayNumber: 2 })).not.toThrow();
  });

  it("rejects a non-positive or non-integer dayNumber", () => {
    expect(() => validateItineraryDayInput({ ...valid, dayNumber: 0 })).toThrow("dayNumber");
    expect(() => validateItineraryDayInput({ ...valid, dayNumber: 1.5 })).toThrow("dayNumber");
  });

  it("rejects a negative altitude", () => {
    expect(() => validateItineraryDayInput({ ...valid, altitudeM: -10 })).toThrow("altitudeM");
  });

  it("rejects photos that aren't an array of strings", () => {
    expect(() => validateItineraryDayInput({ ...valid, photos: "nope" })).toThrow("photos");
    expect(() => validateItineraryDayInput({ ...valid, photos: [1, 2] })).toThrow("photos");
  });
});

describe("validateItineraryUpdateInput", () => {
  it("accepts an empty body (presence enforced by the service, not here)", () => {
    expect(() => validateItineraryUpdateInput({})).not.toThrow();
  });

  it("rejects a non-string location", () => {
    expect(() => validateItineraryUpdateInput({ location: 5 })).toThrow("location");
  });
});
