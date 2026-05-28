#!/usr/bin/env node

import fs from 'node:fs';

const checks = [
  {
    path: 'workflow/config/myra-context.json',
    required: [
      'version',
      'positioning.oneLine',
      'positioning.pillars',
      'accountFitFrame',
      'personaFrames',
      'stageFrames',
      'requiredOutputChecks',
    ],
  },
  {
    path: 'workflow/config/org-resolution.json',
    required: [
      'version',
      'normalization.canonicalDomainRules',
      'normalization.nameRules',
      'evidenceInputs',
      'decisionPolicy.exactCanonicalDomain',
      'decisionPolicy.clearTypoOrNameVariant',
      'decisionPolicy.parentSubsidiary',
      'decisionPolicy.ambiguous',
      'decisionPolicy.noCredibleMatch',
      'dayAiFields',
      'idempotency.organizationKey',
      'receiptRequirements',
    ],
  },
  {
    path: 'workflow/config/ux-guidance.json',
    required: [
      'version',
      'defaultTourMode',
      'tourModes.beginner',
      'tourModes.standard',
      'tourModes.power',
      'firstRunStations',
      'naturalPromptRoutes',
      'receiptLevels.green',
      'receiptLevels.yellow',
      'receiptLevels.red',
      'trustPanel.sections',
      'contactCardTiers.recommended',
      'contactCardTiers.maybe',
      'contactCardTiers.hold',
      'pendingSync.statusLabel',
      'adminReadiness.checks',
      'unifiedReceipt.schemaRef',
      'unifiedReceipt.persistence.localPathTemplate',
      'unifiedReceipt.persistence.dayAiContextPage',
      'renderingMode.narrative',
      'renderingMode.providerBullets',
      'coachingDepth',
      'contactSelection.defaultFlow',
      'contactSelection.powerEscape',
      'endOfTour.triggers',
      'endOfTour.format',
    ],
  },
  {
    path: 'workflow/config/contact-sourcing.json',
    required: [
      'centralizedConnector.enabled',
      'centralizedConnector.executor',
      'centralizedConnector.fallbackWhenUnavailable',
      'leadIdentificationOrder',
      'providers.freshsales.mode',
      'providers.apollo.mode',
      'providers.clearout.mode',
      'approvalRules.createDayAiPerson',
    ],
  },
  {
    path: 'workflow/config/packs.json',
    required: [
      'resolutionOrder',
      'globalDefaults.personaPack',
      'globalDefaults.cadencePack',
      'globalDefaults.channelPack',
      'customization.allowed',
      'customization.collectionStyle',
      'customization.guardrailsCannotOverride',
    ],
  },
];

const errors = [];
for (const check of checks) {
  if (!fs.existsSync(check.path)) {
    errors.push(`Missing ${check.path}`);
    continue;
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(check.path, 'utf8'));
  } catch (error) {
    errors.push(`${check.path}: ${error.message}`);
    continue;
  }
  for (const requiredPath of check.required) {
    const value = getPath(data, requiredPath);
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      errors.push(`${check.path}: missing required value ${requiredPath}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${checks.length} JSON workflow config(s) validated.`);

function getPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}
