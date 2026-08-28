import { describe, expect, it } from "vitest";

import {
  editorLanguageForPath,
  keywordHoverAt,
} from "../src/editor-intellisense.js";

describe("editor IntelliSense", () => {
  it("selects Monaco languages from the real project path", () => {
    expect(editorLanguageForPath("src/formatHabitLabel.ts")).toBe("typescript");
    expect(editorLanguageForPath("src/HabitRow.tsx")).toBe("typescript");
    expect(editorLanguageForPath("vite.config.js")).toBe("javascript");
    expect(editorLanguageForPath("src/HabitRow.jsx")).toBe("javascript");
    expect(editorLanguageForPath("src/styles.css")).toBe("css");
    expect(editorLanguageForPath("package.json")).toBe("json");
    expect(editorLanguageForPath("README.md")).toBe("markdown");
    expect(editorLanguageForPath("LICENSE")).toBe("plaintext");
  });

  it("returns rich reference content only when the pointer is on a whole keyword", () => {
    expect(keywordHoverAt("export class Habit {", 8)).toEqual({
      keyword: "class",
      range: { endColumn: 13, startColumn: 8 },
    });
    expect(keywordHoverAt("export class Habit {", 10)?.keyword).toBe("class");
    expect(keywordHoverAt("export className", 8)).toBeUndefined();
    expect(keywordHoverAt("const classification = 1", 10)).toBeUndefined();
  });
});
