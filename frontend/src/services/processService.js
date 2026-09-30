import { PROCESSES, REQUIREMENT_TEMPLATES, getProcessById } from '../data'
import { resolveAfter, resolvePayload } from './client'

export function fetchProcesses() {
  return resolvePayload(PROCESSES, 260)
}

export function fetchProcess(processId) {
  return resolvePayload(getProcessById(processId), 220)
}

export function fetchRequirementTemplates(processId) {
  return resolvePayload(REQUIREMENT_TEMPLATES[processId] ?? [], 220)
}

export function createApplicationRecord({ processId, name }) {
  const process = getProcessById(processId)
  const template = REQUIREMENT_TEMPLATES[processId] ?? REQUIREMENT_TEMPLATES['other-services']
  const now = new Date().toISOString()

  return resolveAfter(560).then(() => ({
    id: `app-${processId}-${Date.now().toString(36)}`,
    processId,
    name: name ?? process?.name ?? 'New application',
    reference: `REF-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`,
    status: 'in-progress',
    createdAt: now,
    updatedAt: now,
    dueDate: null,
    authority: process?.authority ?? 'Not specified',
    nextStep: 'Start with the required documents at the top of your checklist.',
    details: {},
    requirements: template.map((item) => ({
      key: item.key,
      status: 'missing',
      documentId: null,
    })),
  }))
}
