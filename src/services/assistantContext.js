const applicationModel = require('../models/applicationModel');
const documentModel = require('../models/documentModel');
const { getProcess, processCatalog } = require('../config/processCatalog');
const {
  getExpiryReminderSchedule,
  normalizeExpiryUtcDate
} = require('./expiryReminderSchedule');

const CATALOG_SOURCE_PREFIX = 'catalog';
const REQUIREMENT_SOURCE_PREFIX = 'requirement';
const EXPIRY_SOURCE_PREFIX = 'expiry';

class AssistantContextError extends Error {
  constructor(code) {
    super(code === 'too-large'
      ? 'Assistant context exceeds the configured limit.'
      : 'Assistant context is unavailable.');
    this.name = 'AssistantContextError';
    this.code = code;
  }
}

function createAssistantContextAssembler({
  findApplicationById = applicationModel.findApplicationById,
  findDocumentById = documentModel.findDocumentById,
  getDocumentApplicationIds = documentModel.getDocumentApplicationIds,
  getProcessById = getProcess,
  catalog = processCatalog,
  now = Date.now
} = {}) {
  async function assemble(ownerId, applicationId, maxContextBytes) {
    if (typeof ownerId !== 'string' || ownerId.trim() === ''
        || !Number.isSafeInteger(maxContextBytes) || maxContextBytes <= 0) {
      throw new TypeError('A valid owner ID and context limit are required.');
    }

    const sources = new Map();
    let context;

    if (applicationId === undefined) {
      const processes = Object.values(catalog).map((process) => ({
        processId: process.id,
        name: process.name,
        authority: process.authority,
        requirements: process.requirements.map((requirement) => {
          const sourceKey = `${CATALOG_SOURCE_PREFIX}:${process.id}:${requirement.key}`;
          sources.set(sourceKey, {
            type: 'requirement',
            label: `${process.name}: ${requirement.name}`
          });
          return {
            sourceKey,
            key: requirement.key,
            name: requirement.name,
            type: requirement.type,
            description: requirement.description,
            guidance: requirement.guidance,
            isRequired: requirement.isRequired
          };
        })
      }));
      context = { mode: 'catalog', processes };
    } else {
      const application = await findApplicationById(applicationId, ownerId);
      if (!application) {
        return null;
      }

      const process = getProcessById(application.processId);
      if (!process) {
        throw new AssistantContextError('unavailable');
      }

      const storedRequirements = new Map(
        (Array.isArray(application.requirements) ? application.requirements : [])
          .filter((requirement) => requirement && typeof requirement.key === 'string')
          .map((requirement) => [requirement.key, requirement])
      );

      const requirements = process.requirements.map((definition) => {
        const state = storedRequirements.get(definition.key);
        const status = ['completed', 'in-progress', 'missing'].includes(state?.status)
          ? state.status
          : 'missing';
        const sourceKey = `${REQUIREMENT_SOURCE_PREFIX}:${definition.key}`;
        sources.set(sourceKey, {
          type: 'requirement',
          label: definition.name
        });
        return {
          sourceKey,
          key: definition.key,
          name: definition.name,
          type: definition.type,
          description: definition.description,
          guidance: definition.guidance,
          isRequired: definition.isRequired,
          status
        };
      });

      const expirySummaries = [];
      const expiryLookups = process.requirements.map(async (definition) => {
        const state = storedRequirements.get(definition.key);
        if (typeof state?.documentId !== 'string') {
          return;
        }

        const document = await findDocumentById(state.documentId, ownerId);
        if (!document || document.deleting
            || document.documentType !== definition.type
            || !getDocumentApplicationIds(document).includes(application._id)
            || typeof document.expiresAt !== 'string') {
          return;
        }

        let expiryDate;
        let schedule;
        try {
          expiryDate = normalizeExpiryUtcDate(document.expiresAt);
          schedule = getExpiryReminderSchedule(expiryDate);
        } catch (error) {
          if (error instanceof TypeError || error instanceof RangeError) {
            return;
          }
          throw error;
        }

        const today = new Date(now()).toISOString().slice(0, 10);
        const daysUntilExpiry = Math.round(
          (Date.parse(`${expiryDate}T00:00:00.000Z`)
            - Date.parse(`${today}T00:00:00.000Z`))
          / 86400000
        );
        const sourceKey = `${EXPIRY_SOURCE_PREFIX}:${definition.key}`;
        sources.set(sourceKey, {
          type: 'expiry',
          label: `${definition.name} expiry`
        });
        expirySummaries.push({
          sourceKey,
          requirementKey: definition.key,
          requirementName: definition.name,
          expiryDate,
          daysUntilExpiry,
          reminderDates: schedule.reminders.map(({ leadDays, scheduledDate }) => ({
            leadDays,
            scheduledDate
          }))
        });
      });
      await Promise.all(expiryLookups);

      context = {
        mode: 'application',
        process: {
          processId: process.id,
          name: process.name,
          authority: process.authority
        },
        application: {
          status: ['in-progress', 'submitted', 'completed'].includes(application.status)
            ? application.status
            : 'unknown',
          outcome: ['pending', 'accepted', 'rejected'].includes(application.outcome)
            ? application.outcome
            : null
        },
        requirements,
        expiries: expirySummaries
      };
    }

    if (Buffer.byteLength(JSON.stringify(context), 'utf8') > maxContextBytes) {
      throw new AssistantContextError('too-large');
    }

    return { context, sources };
  }

  return { assemble };
}

const defaultAssistantContextAssembler = createAssistantContextAssembler();

module.exports = {
  AssistantContextError,
  createAssistantContextAssembler,
  defaultAssistantContextAssembler
};
