const { randomBytes, randomUUID } = require('node:crypto');
const database = require('../config/applicationsDatabase');
const { getProcess } = require('../config/processCatalog');

function toPublicApplication(application) {
  if (!application) {
    return null;
  }

  const process = getProcess(application.processId);
  const requirementStates = new Map((application.requirements || []).map((requirement) => [
    requirement.key,
    requirement
  ]));

  return {
    id: application._id,
    processId: application.processId,
    name: application.name,
    reference: application.reference,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    dueDate: application.dueDate,
    authority: application.authority,
    nextStep: application.nextStep,
    details: application.details,
    requirements: (process ? process.requirements : []).map((definition) => {
      const state = requirementStates.get(definition.key);
      return {
        ...definition,
        key: definition.key,
        status: state ? state.status : 'missing',
        documentId: state ? state.documentId : null,
        completedAt: state ? state.completedAt : null
      };
    })
  };
}

function createApplication({ ownerId, processId, name, details }) {
  const process = getProcess(processId);
  const timestamp = new Date().toISOString();
  const id = `app-${randomUUID()}`;
  const reference = `REF-${new Date().getUTCFullYear()}-${randomBytes(8).toString('hex').toUpperCase()}`;
  const application = {
    _id: id,
    ownerId,
    processId,
    name: name || process.name,
    reference,
    status: 'in-progress',
    createdAt: timestamp,
    updatedAt: timestamp,
    dueDate: null,
    authority: process.authority,
    nextStep: 'Start with the required documents at the top of your checklist.',
    details,
    requirements: process.requirements.map(({ key }) => ({
      key,
      status: 'missing',
      documentId: null,
      completedAt: null
    }))
  };

  return new Promise((resolve, reject) => {
    database.insert(application, (error, inserted) => error ? reject(error) : resolve(inserted));
  });
}

function findApplicationsByOwnerId(ownerId) {
  return new Promise((resolve, reject) => {
    database.find({ ownerId }, (error, applications) => {
      if (error) {
        return reject(error);
      }

      applications.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
        || right.createdAt.localeCompare(left.createdAt)
        || left._id.localeCompare(right._id));
      return resolve(applications);
    });
  });
}

function findApplicationById(id, ownerId) {
  return new Promise((resolve, reject) => {
    database.findOne({ _id: id, ownerId }, (error, application) =>
      error ? reject(error) : resolve(application));
  });
}

function findDocumentRequirementReferences(ownerId, documentId) {
  return new Promise((resolve, reject) => {
    database.find({ ownerId }, (error, applications) => {
      if (error) {
        return reject(error);
      }

      const references = applications.flatMap((application) => {
        const process = getProcess(application.processId);
        const definitions = new Map((process ? process.requirements : []).map((requirement) => [
          requirement.key,
          requirement
        ]));

        return (application.requirements || [])
          .filter((requirement) => requirement.documentId === documentId)
          .map((requirement) => ({
            applicationId: application._id,
            documentType: definitions.get(requirement.key)?.type
          }));
      });

      return resolve(references);
    });
  });
}

function updateApplicationRequirements(id, ownerId, requirements) {
  return new Promise((resolve, reject) => {
    database.update(
      { _id: id, ownerId },
      { $set: { requirements, updatedAt: new Date().toISOString() } },
      { returnUpdatedDocs: true },
      (error, count, application) => {
        if (error) {
          return reject(error);
        }

        return resolve(count > 0 ? application : null);
      }
    );
  });
}

function clearDocumentRequirementReferences(ownerId, documentId) {
  return new Promise((resolve, reject) => {
    database.find({ ownerId }, (findError, applications) => {
      if (findError) {
        return reject(findError);
      }

      const affected = applications.filter((application) =>
        (application.requirements || []).some((requirement) => requirement.documentId === documentId));
      Promise.all(affected.map((application) => {
        const requirements = application.requirements.map((requirement) =>
          requirement.documentId === documentId
            ? { ...requirement, status: 'missing', documentId: null, completedAt: null }
            : requirement);
        return updateApplicationRequirements(application._id, ownerId, requirements);
      })).then(() => resolve()).catch(reject);
    });
  });
}

function deleteApplicationsByOwnerId(ownerId) {
  return new Promise((resolve, reject) => {
    database.remove({ ownerId }, { multi: true }, (error, count) =>
      error ? reject(error) : resolve(count));
  });
}

module.exports = {
  clearDocumentRequirementReferences,
  createApplication,
  deleteApplicationsByOwnerId,
  findApplicationById,
  findApplicationsByOwnerId,
  findDocumentRequirementReferences,
  toPublicApplication,
  updateApplicationRequirements
};
