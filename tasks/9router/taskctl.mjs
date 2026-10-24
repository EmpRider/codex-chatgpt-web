#!/usr/bin/env node
/**
 * Dependency-free file-based task tracker for this fork's 9Router extension.
 * The manifest is authoritative; task markdown files contain the specifications.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(root, 'manifest.json');
const statuses = new Set(['todo', 'in_progress', 'blocked', 'done']);

function fail(message) {
  throw new Error(message);
}

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function validate(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('Unsupported manifest schemaVersion');
  if (!Array.isArray(manifest.epics) || !Array.isArray(manifest.tasks)) {
    return ['Manifest must contain epics and tasks arrays'];
  }
  const epics = new Set();
  for (const epic of manifest.epics) {
    if (epics.has(epic.id)) errors.push(`Duplicate epic ${epic.id}`);
    epics.add(epic.id);
    if (typeof epic.file !== 'string' || !existsSync(join(root, epic.file))) {
      errors.push(`Missing epic file for ${epic.id}`);
    }
  }
  const byId = new Map();
  for (const task of manifest.tasks) {
    if (byId.has(task.id)) errors.push(`Duplicate task ${task.id}`);
    byId.set(task.id, task);
    if (!statuses.has(task.status)) errors.push(`Invalid status for ${task.id}`);
    if (!epics.has(task.epic)) errors.push(`Unknown epic for ${task.id}`);
    if (!Array.isArray(task.dependsOn)) errors.push(`Missing dependsOn array for ${task.id}`);
    if (!Array.isArray(task.evidence)) errors.push(`Missing evidence array for ${task.id}`);
    if (typeof task.file !== 'string' || !resolve(root, task.file).startsWith(root + sep) || !existsSync(join(root, task.file))) {
      errors.push(`Missing or unsafe task file for ${task.id}`);
    }
    if (task.status === 'done' && (!Array.isArray(task.evidence) || task.evidence.length === 0)) {
      errors.push(`${task.id} is done without evidence`);
    }
    if (task.status === 'blocked' && !task.blockedReason) errors.push(`${task.id} blocked without reason`);
    if (task.status !== 'blocked' && task.blockedReason) errors.push(`${task.id} stale blockedReason`);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`Dependency cycle at ${id}`); return; }
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) { errors.push(`Unknown dependency ${id}`); return; }
    visiting.add(id);
    for (const dependency of task.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const task of manifest.tasks) visit(task.id);
  for (const task of manifest.tasks) {
    if (['in_progress', 'done'].includes(task.status)) {
      const missing = task.dependsOn.filter(id => byId.get(id)?.status !== 'done');
      if (missing.length) errors.push(`${task.id} started before dependencies: ${missing.join(', ')}`);
    }
  }
  return [...new Set(errors)];
}

function save(manifest) {
  const errors = validate(manifest);
  if (errors.length) fail(`Cannot save invalid task state:\n${errors.join('\n')}`);
  const temp = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(temp, manifestPath);
}

function update(task, status, { evidence, reason } = {}) {
  if (status === 'in_progress') {
    if (task.status !== 'todo') fail(`${task.id} must be todo before starting (currently ${task.status})`);
    task.status = 'in_progress';
  } else if (status === 'done') {
    if (task.status !== 'in_progress') fail(`${task.id} must be in_progress before completing`);
    if (!evidence || !evidence.trim()) fail('Completing a task requires --evidence with a verifiable reference');
    task.evidence.push(evidence.trim());
    task.status = 'done';
  } else if (status === 'blocked') {
    if (task.status === 'done') fail('Completed tasks cannot be blocked');
    if (!reason || !reason.trim()) fail('Blocking a task requires --reason');
    task.blockedReason = reason.trim();
    task.status = 'blocked';
  } else if (status === 'todo') {
    if (task.status !== 'blocked') fail('Only blocked tasks can be unblocked');
    task.status = 'todo';
    task.blockedReason = null;
  } else fail(`Invalid status transition: ${status}`);
  task.updatedAt = new Date().toISOString();
}

function printSummary(manifest) {
  const counts = Object.fromEntries([...statuses].map(s => [s, 0]));
  for (const task of manifest.tasks) counts[task.status]++;
  console.log(`9Router: ${manifest.tasks.length} tasks | ${counts.done} done | ${counts.in_progress} in progress | ${counts.blocked} blocked | ${counts.todo} todo`);
  for (const epic of manifest.epics) {
    const subtasks = manifest.tasks.filter(t => t.epic === epic.id);
    console.log(`${epic.id} ${String(subtasks.filter(t => t.status === 'done').length).padStart(2)}/${String(subtasks.length).padStart(2)} ${epic.title}`);
  }
}

function usage() {
  console.log('Usage: node tasks/9router/taskctl.mjs summary | list [status] | show ID | validate | start ID | block ID --reason TEXT | unblock ID | done ID --evidence REF');
}

try {
  const [command, id, flag, ...tail] = process.argv.slice(2);
  if (!command || ['help', '-h', '--help'].includes(command)) { usage(); process.exit(0); }
  const manifest = readManifest();
  const errors = validate(manifest);
  if (errors.length) fail(`Invalid manifest:\n${errors.join('\n')}`);
  if (command === 'validate') console.log(`Valid: ${manifest.epics.length} epics and ${manifest.tasks.length} tasks`);
  else if (command === 'summary') printSummary(manifest);
  else if (command === 'list') {
    if (id && !statuses.has(id)) fail(`Unknown status filter ${id}`);
    for (const task of manifest.tasks) if (!id || task.status === id) {
      console.log(`${task.id}\t${task.status.padEnd(11)}\t${task.epic}\t${task.title}`);
    }
  } else if (command === 'show') {
    const task = manifest.tasks.find(x => x.id === id);
    if (!task) fail(`Unknown task ${id}`);
    console.log(`${task.id} (${task.status}) | depends on: ${task.dependsOn.join(', ') || 'none'} | evidence: ${task.evidence.join('; ') || 'none'}`);
    console.log(readFileSync(join(root, task.file), 'utf8'));
  } else if (['start', 'block', 'unblock', 'done'].includes(command)) {
    const task = manifest.tasks.find(x => x.id === id);
    if (!task) fail(`Unknown task ${id}`);
    if (command === 'block' && flag !== '--reason') fail('Use --reason TEXT');
    if (command === 'done' && flag !== '--evidence') fail('Use --evidence REF');
    if (['start', 'unblock'].includes(command) && flag) fail(`Unexpected argument ${flag}`);
    const textValue = tail.join(' ').trim();
    update(task, { start: 'in_progress', block: 'blocked', unblock: 'todo', done: 'done' }[command], {
      evidence: command === 'done' ? textValue : undefined,
      reason: command === 'block' ? textValue : undefined,
    });
    save(manifest);
    console.log(`${task.id} -> ${task.status}`);
  } else fail(`Unknown command ${command}`);
} catch (error) {
  console.error(`taskctl: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
