import { describe, expect, it } from "vitest";

import { formatHabitLabel } from "./formatHabitLabel";

describe("formatHabitLabel", () => {
  it("formats a supplied habit name", () => {
    expect(formatHabitLabel("Read")).toBe("Habit: Read");
  });
});
