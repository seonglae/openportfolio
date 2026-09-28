/**
 * The skills in skills/ describe the MCP server's tools in prose, and prose
 * does not fail to compile when a tool is renamed. These tests are what does.
 * They also run the installer the way a user would, against a scratch
 * directory, since a copy that lands one level too deep is invisible until an
 * agent fails to find the skill.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SKILLS = join(ROOT, "skills");
const CLI = join(ROOT, "bin/openportfolio.mjs");
const SERVER = join(ROOT, "mcp/portfolio-server.mjs");

function serverToolNames(): string[] {
  const src = readFileSync(SERVER, "utf8");
  return [...src.matchAll(/\btool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

function skills(): Array<{ dir: string; text: string }> {
  return readdirSync(SKILLS).map((dir) => ({ dir, text: readFileSync(join(SKILLS, dir, "SKILL.md"), "utf8") }));
}

const scratch: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openportfolio-skills-"));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], cwd: string, home: string): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("the skills describe the server that exists", () => {
  it("finds skills and tools at all", () => {
    expect(skills().length).toBeGreaterThanOrEqual(4);
    expect(serverToolNames().length).toBeGreaterThanOrEqual(20);
  });

  it("names each skill after its directory, which is how an agent CLI finds it", () => {
    for (const { dir, text } of skills()) {
      expect(text.startsWith("---\n")).toBe(true);
      expect(text).toMatch(new RegExp(`^name: ${dir}$`, "m"));
      expect(text).toMatch(/^description: .{40,}$/m);
    }
  });

  // Tool names are the only snake_case identifiers the skills put in backticks.
  it("mentions no tool the server does not register", () => {
    const tools = new Set(serverToolNames());
    const mentioned = new Set<string>();
    for (const { text } of skills()) {
      for (const m of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) mentioned.add(m[1]);
    }
    expect(mentioned.size).toBeGreaterThanOrEqual(15);
    for (const name of mentioned) expect(tools.has(name), name).toBe(true);
    for (const name of ["whoami", "calibration"]) expect(tools.has(name)).toBe(true);
  });
});

describe("openportfolio skills install", () => {
  it("copies every skill into ./.claude/skills", () => {
    const cwd = tempDir();
    const out = run(["skills", "install"], cwd, tempDir());
    for (const { dir } of skills()) expect(existsSync(join(cwd, ".claude/skills", dir, "SKILL.md"))).toBe(true);
    expect(out).toContain(`installed ${skills().length} skills`);
  });

  it("copies into the home directory with --global", () => {
    const home = tempDir();
    const cwd = tempDir();
    run(["skills", "install", "--global"], cwd, home);
    expect(existsSync(join(home, ".claude/skills/openportfolio-book/SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  // An installed skill may carry its owner's edits.
  it("leaves an installed skill alone unless told to replace it", () => {
    const cwd = tempDir();
    const home = tempDir();
    run(["skills", "install"], cwd, home);
    const installed = join(cwd, ".claude/skills/openportfolio-book/SKILL.md");
    writeFileSync(installed, "edited");

    expect(run(["skills", "install"], cwd, home)).toContain("skip openportfolio-book");
    expect(readFileSync(installed, "utf8")).toBe("edited");

    run(["skills", "install", "--force"], cwd, home);
    expect(readFileSync(installed, "utf8")).toContain("name: openportfolio-book");
  });

  it("lists what it would install", () => {
    const names = run(["skills", "list"], tempDir(), tempDir()).trim().split("\n");
    expect(names).toEqual(
      skills()
        .map((s) => s.dir)
        .sort(),
    );
  });

  it("refuses a command it does not know", () => {
    expect(() => run(["skills", "uninstall"], tempDir(), tempDir())).toThrow();
  });
});
