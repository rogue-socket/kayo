#!/usr/bin/env node
// Validate .github/registry.json against the actual repo state.
// Exits 0 on a clean registry, 1 with a printed list on any failures.
// Self-extend calls this as a pre-commit check after editing the registry.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(REPO_ROOT, '.github', 'registry.json');
const ROUTING_PATH = path.join(REPO_ROOT, '.github', 'copilot-instructions.md');

const issues = [];
function fail(msg) { issues.push(msg); }

function readJsonOrFail(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.log(`FAIL — ${label} unreadable / invalid JSON: ${err.message}`);
    process.exit(1);
  }
}

const registry = readJsonOrFail(REGISTRY_PATH, '.github/registry.json');

for (const key of ['skills', 'services', 'tools']) {
  if (!Array.isArray(registry[key])) fail(`registry.json: missing/non-array "${key}"`);
}

function checkUniqueNames(arr, label) {
  const seen = new Set();
  for (const entry of arr || []) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      fail(`${label}: an entry has no name`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) {
      fail(`${label} "${entry.name}": name must be kebab-case lowercase`);
    }
    if (seen.has(entry.name)) fail(`${label}: duplicate name "${entry.name}"`);
    seen.add(entry.name);
  }
}
checkUniqueNames(registry.skills, 'skills');
checkUniqueNames(registry.services, 'services');
checkUniqueNames(registry.tools, 'tools');

for (const skill of registry.skills || []) {
  if (!skill.path) { fail(`skill "${skill.name}": no path`); continue; }
  if (skill.path.includes('..')) {
    fail(`skill "${skill.name}": path traversal not allowed (${skill.path})`);
    continue;
  }
  const abs = path.resolve(REPO_ROOT, skill.path);
  if (!fs.existsSync(abs)) {
    fail(`skill "${skill.name}": file not found at ${skill.path}`);
    continue;
  }
  const content = fs.readFileSync(abs, 'utf8');
  if (!/^---\s*\n(?:[^\n]*\n)*name:\s*\S+/m.test(content)) {
    fail(`skill "${skill.name}": missing frontmatter "name:" in ${skill.path}`);
  }
  if (!/^description:\s*\S+/m.test(content)) {
    fail(`skill "${skill.name}": missing frontmatter "description:" in ${skill.path}`);
  }
}

for (const svc of registry.services || []) {
  if (!svc.entrypoint) { fail(`service "${svc.name}": no entrypoint`); continue; }
  if (svc.entrypoint.includes('..')) {
    fail(`service "${svc.name}": path traversal not allowed (${svc.entrypoint})`);
    continue;
  }
  const abs = path.resolve(REPO_ROOT, svc.entrypoint);
  if (!fs.existsSync(abs)) fail(`service "${svc.name}": entrypoint not found at ${svc.entrypoint}`);
}

for (const tool of registry.tools || []) {
  if (!tool.binPath) { fail(`tool "${tool.name}": no binPath`); continue; }
  const abs = path.isAbsolute(tool.binPath) ? tool.binPath : path.resolve(REPO_ROOT, tool.binPath);
  if (!fs.existsSync(abs)) fail(`tool "${tool.name}": binPath not found at ${tool.binPath}`);
}

let routing;
try {
  routing = fs.readFileSync(ROUTING_PATH, 'utf8');
} catch (err) {
  fail(`copilot-instructions.md unreadable: ${err.message}`);
  routing = '';
}
for (const skill of registry.skills || []) {
  if (!skill.path) continue;
  if (!routing.includes(skill.path)) {
    fail(`skill "${skill.name}": no routing line in copilot-instructions.md referencing ${skill.path}`);
  }
}

if (issues.length === 0) {
  console.log(`OK — registry is consistent (${registry.skills.length} skills, ${registry.services.length} services, ${registry.tools.length} tools)`);
  process.exit(0);
}
console.log(`FAIL — ${issues.length} issue(s):`);
for (const issue of issues) console.log(`  - ${issue}`);
process.exit(1);
