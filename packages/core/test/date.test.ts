import { describe, expect, it } from "vitest";
import { addDays, addMonths, dateParts, dayKey, daysBetween } from "../src/date.ts";

describe("calendar math", () => {
  it("crosses a year end without special-casing it", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("gives the same answer regardless of the ambient timezone", () => {
    // A DST-shifting local zone would move this day if the math went through a
    // local Date; it goes through Date.UTC precisely so it cannot.
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
  });

  it("keeps 29 February only in a leap year", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("walks months backwards across a year boundary", () => {
    expect(addMonths("2026-01-15", -2)).toBe("2025-11-15");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
  });

  it("counts whole days between two calendar dates", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-01-31", "2026-01-01")).toBe(-30);
  });

  it("derives a day key from an epoch in UTC", () => {
    expect(dayKey(Date.UTC(2026, 7, 3, 23, 59))).toBe("2026-08-03");
    expect(dateParts("2026-08-03")).toEqual([2026, 8, 3]);
  });
});
