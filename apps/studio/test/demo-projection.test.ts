import { describe, expect, it } from "vitest";

import { projectDemoSource } from "../src/demo-projection.js";

const events = [
  {
    id: "type-declaration",
    type: "demo.patch" as const,
    path: "lesson/formatHabitLabel.demo.ts",
    patch: "export function ",
    atMs: 1_000,
    endMs: 2_500,
  },
  {
    id: "type-name",
    type: "demo.patch" as const,
    path: "lesson/formatHabitLabel.demo.ts",
    patch: "export function formatHabitLabel",
    atMs: 3_000,
    endMs: 4_500,
  },
];

describe("demo source projection", () => {
  it("types cumulative demo snapshots without mutating learner source", () => {
    expect(projectDemoSource(events, 500)).toEqual({
      path: "lesson/formatHabitLabel.demo.ts",
      source: "",
      typing: false,
    });
    expect(projectDemoSource(events, 1_000)).toEqual({
      path: "lesson/formatHabitLabel.demo.ts",
      source: "e",
      typing: true,
    });
    expect(projectDemoSource(events, 2_500)).toEqual({
      path: "lesson/formatHabitLabel.demo.ts",
      source: "export function ",
      typing: true,
    });
    expect(projectDemoSource(events, 3_750)).toEqual({
      path: "lesson/formatHabitLabel.demo.ts",
      source: "export function formatHa",
      typing: true,
    });
    expect(projectDemoSource(events, 4_500)).toEqual({
      path: "lesson/formatHabitLabel.demo.ts",
      source: "export function formatHabitLabel",
      typing: false,
    });
  });

  it("stops projecting at the challenge snapshot", () => {
    expect(projectDemoSource(events, 3_500, 3_500)).toBeUndefined();
  });
});
