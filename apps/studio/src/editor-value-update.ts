export type EditorValueUpdate =
  | { type: "none" }
  | { type: "append"; text: string }
  | { type: "replace"; value: string };

export function planEditorValueUpdate(
  currentValue: string,
  nextValue: string,
): EditorValueUpdate {
  if (currentValue === nextValue) {
    return { type: "none" };
  }
  if (nextValue.startsWith(currentValue)) {
    return { type: "append", text: nextValue.slice(currentValue.length) };
  }
  return { type: "replace", value: nextValue };
}
