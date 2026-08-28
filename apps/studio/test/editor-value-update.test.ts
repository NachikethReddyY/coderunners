import { describe, expect, it } from "vitest";

import { planEditorValueUpdate } from "../src/editor-value-update.js";

describe("editor value updates", () => {
  it("appends projected typing without replacing Monaco's tokenized document", () => {
    expect(planEditorValueUpdate("export functio", "export function")).toEqual({
      type: "append",
      text: "n",
    });
  });

  it("replaces the document when playback seeks backward", () => {
    expect(planEditorValueUpdate("export function", "export")).toEqual({
      type: "replace",
      value: "export",
    });
  });
});
