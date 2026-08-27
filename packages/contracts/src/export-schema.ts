import { mkdir, writeFile } from "node:fs/promises";

import { CodecastDraftSchema } from "./codecast-draft.js";
import { CodecastManifestSchema } from "./codecast-manifest.js";

const schemaDirectory = new URL("../schemas/", import.meta.url);

await mkdir(schemaDirectory, { recursive: true });
await writeFile(
  new URL("codecast-draft.json", schemaDirectory),
  `${JSON.stringify(CodecastDraftSchema, null, 2)}\n`,
  "utf8",
);
await writeFile(
  new URL("codecast-manifest.json", schemaDirectory),
  `${JSON.stringify(CodecastManifestSchema, null, 2)}\n`,
  "utf8",
);
