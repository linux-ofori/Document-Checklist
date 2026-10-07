import { PROCESSES, REQUIREMENT_TEMPLATES, getProcessById } from '../data'
import { resolvePayload } from './client'
import { createApplication } from './applicationService'

export function fetchProcesses() {
  return resolvePayload(PROCESSES, 260)
}

export function fetchProcess(processId) {
  return resolvePayload(getProcessById(processId), 220)
}

export function fetchRequirementTemplates(processId) {
  return resolvePayload(REQUIREMENT_TEMPLATES[processId] ?? [], 220)
}

export const createApplicationRecord = createApplication
