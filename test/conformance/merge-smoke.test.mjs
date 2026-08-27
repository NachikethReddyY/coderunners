import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function requireFile(relativePath) {
  const absolutePath = join(root, relativePath);
  await access(absolutePath, constants.F_OK);
  return absolutePath;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(await requireFile(relativePath), "utf8"));
}

test("declares the pnpm workspace and Turborepo task graph", async () => {
  const workspace = await readFile(await requireFile("pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
  assert.match(workspace, /services\/\*/);

  const turbo = await readJson("turbo.json");
  assert.ok(turbo.tasks?.check, "turbo must own the check task");
  assert.ok(turbo.tasks?.test, "turbo must own the test task");
  assert.deepEqual(turbo.tasks.test.dependsOn, ["^test"]);
});

test("keeps every proposed runtime boundary as a package or service", async () => {
  const expectedFiles = [
    "apps/studio/package.json",
    "apps/local-host/package.json",
    "services/media/pyproject.toml",
    "packages/contracts/package.json",
    "packages/lesson-player/package.json",
  ];

  for (const relativePath of expectedFiles) {
    await requireFile(relativePath);
  }
});

test("exposes the documented package names and focused commands", async () => {
  const packages = await Promise.all(
    [
      ["apps/studio/package.json", "@coderunners/studio"],
      ["apps/local-host/package.json", "@coderunners/local-host"],
      ["packages/contracts/package.json", "@coderunners/contracts"],
      ["packages/lesson-player/package.json", "@coderunners/lesson-player"],
    ].map(async ([relativePath, expectedName]) => {
      const packageJson = await readJson(relativePath);
      assert.equal(packageJson.name, expectedName);
      assert.equal(typeof packageJson.scripts?.check, "string");
      assert.equal(typeof packageJson.scripts?.test, "string");
      return packageJson;
    }),
  );

  const [studio, localHost, contracts, lessonPlayer] = packages;
  assert.ok(studio.dependencies?.["@coderunners/contracts"]);
  assert.ok(studio.dependencies?.["@coderunners/lesson-player"]);
  assert.ok(localHost.dependencies?.["@coderunners/contracts"]);
  assert.equal(studio.dependencies?.["@coderunners/local-host"], undefined);
  assert.equal(studio.dependencies?.["@coderunners/media"], undefined);
  assert.equal(contracts.dependencies?.["@coderunners/lesson-player"], undefined);
  assert.equal(lessonPlayer.dependencies?.["@coderunners/studio"], undefined);
});

test("wires the standalone conformance command into the root scripts", async () => {
  const packageJson = await readJson("package.json");
  assert.equal(packageJson.scripts?.["test:conformance"], "sh test/conformance/run.sh");
});
