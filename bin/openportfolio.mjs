#!/usr/bin/env node
// openportfolio: the command line that ships with the repo.
//
// One command today: copy the agent skills in skills/ to where an agent CLI
// looks for them. Plain node with no imports beyond the standard library, for
// the same reason as mcp/portfolio-server.mjs: a .ts specifier would put a node
// version floor on a command whose whole job is to copy some files.
//
//   openportfolio skills list
//   openportfolio skills install [--global] [--force]

import { cpSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));
const SKILL_FILE = "SKILL.md";

const USAGE = `usage: openportfolio skills list
       openportfolio skills install [--global] [--force]

  install    copy the openportfolio skills into ./.claude/skills
  --global   into ~/.claude/skills instead, for every project
  --force    replace a skill that is already installed`;

function skillNames() {
  const out = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, SKILL_FILE))) out.push(entry.name);
  }
  return out.sort();
}

// An installed skill may have been edited by its owner, so it is only replaced
// when asked. A skipped one is named, never skipped silently.
function install(flags) {
  const base = flags.includes("--global") ? homedir() : process.cwd();
  const target = resolve(base, ".claude", "skills");
  const force = flags.includes("--force");
  let copied = 0;
  for (const name of skillNames()) {
    const dest = join(target, name);
    if (existsSync(dest) && !force) {
      console.log(`  skip ${name}: already installed (--force replaces it)`);
      continue;
    }
    cpSync(join(SKILLS_DIR, name), dest, { recursive: true, force: true });
    console.log(`  ${name}`);
    copied += 1;
  }
  console.log(`installed ${copied} skill${copied === 1 ? "" : "s"} into ${target}`);
}

function main(argv) {
  const [group, command, ...flags] = argv;
  if (group === "skills" && command === "list") {
    for (const name of skillNames()) console.log(name);
    return 0;
  }
  if (group === "skills" && command === "install") {
    install(flags);
    return 0;
  }
  if (group === undefined || group === "help" || group === "--help" || group === "-h") {
    console.log(USAGE);
    return 0;
  }
  console.error(USAGE);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
