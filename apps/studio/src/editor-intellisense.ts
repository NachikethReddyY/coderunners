export type EditorLanguage =
  | "css"
  | "html"
  | "javascript"
  | "json"
  | "markdown"
  | "plaintext"
  | "typescript";

export type KeywordReference = {
  category: string;
  detail: string;
  label: string;
  since?: string;
  syntax: string;
};

export const keywordReferences = {
  async: {
    category: "Function modifier",
    detail: "Declares a function that always returns a Promise and may pause at await expressions.",
    label: "async",
    since: "ES2017",
    syntax: "async function name() {\n  const value = await promise;\n  return value;\n}",
  },
  await: {
    category: "Async expression",
    detail: "Pauses the surrounding async function until a Promise settles, then returns its fulfilled value.",
    label: "await",
    since: "ES2017",
    syntax: "const value = await promise;",
  },
  class: {
    category: "Declaration",
    detail: "Declares a class with a constructor, methods, accessors, and static members.",
    label: "class",
    since: "ES6 feature",
    syntax: "class Name {\n  constructor() {}\n  method() {}\n  static staticMethod() {}\n  get property() {}\n}",
  },
  const: {
    category: "Block-scoped binding",
    detail: "Declares a block-scoped binding that cannot be reassigned after initialization.",
    label: "const",
    since: "ES6 feature",
    syntax: "const name = value;",
  },
  export: {
    category: "Module declaration",
    detail: "Makes a declaration or value available to other JavaScript or TypeScript modules.",
    label: "export",
    since: "ES6 feature",
    syntax: "export function name() {}\nexport { name };",
  },
  extends: {
    category: "Inheritance clause",
    detail: "Creates a class or interface from another type while retaining its inherited members.",
    label: "extends",
    syntax: "class Child extends Parent {}",
  },
  function: {
    category: "Declaration",
    detail: "Declares a reusable function with named parameters and an optional return value.",
    label: "function",
    syntax: "function name(parameter: Type): ReturnType {\n  return value;\n}",
  },
  import: {
    category: "Module declaration",
    detail: "Loads exported bindings from another JavaScript or TypeScript module.",
    label: "import",
    since: "ES6 feature",
    syntax: 'import { name } from "./module";',
  },
  interface: {
    category: "Type declaration",
    detail: "Names the shape of an object and can be extended or implemented by other declarations.",
    label: "interface",
    syntax: "interface Name {\n  property: Type;\n}",
  },
  let: {
    category: "Block-scoped binding",
    detail: "Declares a block-scoped variable that can be reassigned.",
    label: "let",
    since: "ES6 feature",
    syntax: "let name = value;",
  },
  new: {
    category: "Constructor expression",
    detail: "Creates an object instance by calling a class or constructor function.",
    label: "new",
    syntax: "const instance = new Name();",
  },
  return: {
    category: "Control flow",
    detail: "Stops the current function and optionally supplies its result to the caller.",
    label: "return",
    syntax: "return value;",
  },
  type: {
    category: "Type declaration",
    detail: "Creates a reusable name for a TypeScript type expression.",
    label: "type",
    syntax: "type Name = ExistingType;",
  },
} satisfies Record<string, KeywordReference>;

export type SupportedKeyword = keyof typeof keywordReferences;

const languageByExtension: Record<string, EditorLanguage> = {
  ".css": "css",
  ".htm": "html",
  ".html": "html",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
};

const keywordPattern = new RegExp(`\\b(${Object.keys(keywordReferences).join("|")})\\b`, "g");

export function editorLanguageForPath(path: string): EditorLanguage {
  const filename = path.split("/").at(-1)?.toLowerCase() ?? "";
  const extensionStart = filename.lastIndexOf(".");
  const extension = extensionStart < 0 ? "" : filename.slice(extensionStart);
  return languageByExtension[extension] ?? "plaintext";
}

export function keywordHoverAt(
  line: string,
  column: number,
): { keyword: SupportedKeyword; range: { endColumn: number; startColumn: number } } | undefined {
  keywordPattern.lastIndex = 0;
  for (const match of line.matchAll(keywordPattern)) {
    const startColumn = (match.index ?? 0) + 1;
    const endColumn = startColumn + match[0].length;
    if (column >= startColumn && column <= endColumn) {
      return {
        keyword: match[0] as SupportedKeyword,
        range: { endColumn, startColumn },
      };
    }
  }
  return undefined;
}
