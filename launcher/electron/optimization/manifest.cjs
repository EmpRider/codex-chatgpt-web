const TOOL_MANIFEST = Object.freeze({
  "i-have-adhd": Object.freeze({
    id: "i-have-adhd",
    name: "i-have-adhd",
    kind: "skill",
    repository: "ayghri/i-have-adhd",
    branch: "main",
    sourcePath: "skills/i-have-adhd/SKILL.md",
    licensePath: "LICENSE",
  }),
  ponytail: Object.freeze({
    id: "ponytail",
    name: "Ponytail",
    kind: "skill",
    repository: "DietrichGebert/ponytail",
    branch: "main",
    sourcePath: "skills/ponytail/SKILL.md",
    licensePath: "LICENSE",
  }),
  caveman: Object.freeze({
    id: "caveman",
    name: "Caveman",
    kind: "skill",
    repository: "JuliusBrussee/caveman",
    branch: "main",
    sourcePath: "skills/caveman/SKILL.md",
    licensePath: "LICENSE",
  }),
  rtk: Object.freeze({
    id: "rtk",
    name: "RTK",
    kind: "binary",
    repository: "rtk-ai/rtk",
    release: true,
  }),
  headroom: Object.freeze({
    id: "headroom",
    name: "Headroom",
    kind: "service",
    repository: "headroomlabs-ai/headroom",
    release: true,
  }),
  jev: Object.freeze({
    id: "jev",
    name: "Jev",
    kind: "module",
    repository: "Loule95450/jev-free-router",
    branch: "master",
    sourcePath: "src",
    licensePath: "LICENSE",
  }),
});

function toolIds() {
  return Object.keys(TOOL_MANIFEST);
}

function toolDefinition(id) {
  const definition = TOOL_MANIFEST[id];
  if (!definition) throw new Error(`Unknown optimization component: ${id}`);
  return definition;
}

module.exports = { TOOL_MANIFEST, toolDefinition, toolIds };
