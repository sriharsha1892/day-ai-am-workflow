#!/usr/bin/env node

import fs from 'node:fs';

const packPath = process.argv[2] ?? 'workflow/config/packs.json';
const packs = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const errors = [];

requireObject(packs, 'root');
requireArray(packs.resolutionOrder, 'resolutionOrder');
requireObject(packs.globalDefaults, 'globalDefaults');
requireObject(packs.personaPacks, 'personaPacks');
requireObject(packs.cadencePacks, 'cadencePacks');
requireObject(packs.channelPacks, 'channelPacks');
requireObject(packs.customization, 'customization');

if (packs.globalDefaults) {
  if (!packs.personaPacks?.[packs.globalDefaults.personaPack]) {
    errors.push(`globalDefaults.personaPack "${packs.globalDefaults.personaPack}" is not defined`);
  }
  if (!packs.cadencePacks?.[packs.globalDefaults.cadencePack]) {
    errors.push(`globalDefaults.cadencePack "${packs.globalDefaults.cadencePack}" is not defined`);
  }
  if (!packs.channelPacks?.[packs.globalDefaults.channelPack]) {
    errors.push(`globalDefaults.channelPack "${packs.globalDefaults.channelPack}" is not defined`);
  }
}

for (const [id, pack] of Object.entries(packs.personaPacks ?? {})) {
  if (!pack.label) errors.push(`personaPacks.${id}.label is required`);
  if (!Array.isArray(pack.roleBuckets) || pack.roleBuckets.length === 0) {
    errors.push(`personaPacks.${id}.roleBuckets must include at least one role`);
  }
  if (!pack.useWhen) errors.push(`personaPacks.${id}.useWhen is required`);
}

for (const [id, pack] of Object.entries(packs.cadencePacks ?? {})) {
  if (!pack.label) errors.push(`cadencePacks.${id}.label is required`);
  if (!Number.isInteger(pack.durationBusinessDays) || pack.durationBusinessDays < 1) {
    errors.push(`cadencePacks.${id}.durationBusinessDays must be a positive integer`);
  }
  if (!Array.isArray(pack.steps) || pack.steps.length === 0) {
    errors.push(`cadencePacks.${id}.steps must include at least one step`);
    continue;
  }
  for (const [stepIndex, step] of pack.steps.entries()) {
    const prefix = `cadencePacks.${id}.steps[${stepIndex}]`;
    if (!Number.isInteger(step.day) || step.day < 0) errors.push(`${prefix}.day must be a non-negative integer`);
    if (!step.channel) errors.push(`${prefix}.channel is required`);
    if (!step.purpose) errors.push(`${prefix}.purpose is required`);
  }
}

for (const [id, pack] of Object.entries(packs.channelPacks ?? {})) {
  if (!pack.label) errors.push(`channelPacks.${id}.label is required`);
  if (!Array.isArray(pack.allowedChannels) || pack.allowedChannels.length === 0) {
    errors.push(`channelPacks.${id}.allowedChannels must include at least one channel`);
  }
  if (!Array.isArray(pack.manualOnlyChannels)) {
    errors.push(`channelPacks.${id}.manualOnlyChannels must be an array`);
  }
}

if (!Array.isArray(packs.customization?.allowed) || packs.customization.allowed.length === 0) {
  errors.push('customization.allowed must include at least one option');
}
if (!Array.isArray(packs.customization?.guardrailsCannotOverride) || packs.customization.guardrailsCannotOverride.length === 0) {
  errors.push('customization.guardrailsCannotOverride must include at least one guardrail');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${Object.keys(packs.personaPacks).length} persona pack(s), ${Object.keys(packs.cadencePacks).length} cadence pack(s), ${Object.keys(packs.channelPacks).length} channel pack(s) validated.`);

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${name} must be an object`);
  }
}

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array`);
  }
}

