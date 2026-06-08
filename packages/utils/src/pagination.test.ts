import { describe, expect, it } from "vitest";
import { paginate } from "./pagination.js";

describe("paginate", () => {
  it("uses defaults when no arguments are given", () => {
    expect(paginate()).toEqual({ skip: 0, take: 20 });
  });

  it("converts a page and limit into skip/take", () => {
    expect(paginate(3, 10)).toEqual({ skip: 20, take: 10 });
  });

  it("clamps a page below 1 up to the first page", () => {
    expect(paginate(0, 10)).toEqual({ skip: 0, take: 10 });
    expect(paginate(-5, 10)).toEqual({ skip: 0, take: 10 });
  });

  it("caps the limit at the maximum page size", () => {
    expect(paginate(1, 500)).toEqual({ skip: 0, take: 100 });
  });

  it("floors fractional page and limit values", () => {
    expect(paginate(2.9, 10.7)).toEqual({ skip: 10, take: 10 });
  });
});
