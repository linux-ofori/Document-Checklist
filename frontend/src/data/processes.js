export const PROCESS_ICON_KEYS = [
  'passport',
  'business',
  'driving',
  'university',
  'national-id',
  'general',
]

export const PROCESSES = [
  {
    id: 'passport',
    name: 'Passport Application',
    shortName: 'Passport',
    icon: 'passport',
    category: 'personal',
    description:
      'Apply for a new Ghana passport or renew an existing one. We list every document the immigration office asks for.',
    requirementCount: 7,
    estimatedTime: '10 minutes to prepare',
    authority: 'Ghana Immigration Service',
    turnaround: '10 to 21 working days',
    updatedAt: '2026-08-18',
    popularity: 'Most used',
  },
  {
    id: 'business-registration',
    name: 'Business Registration',
    shortName: 'Business',
    icon: 'business',
    category: 'business',
    description:
      'Register a new company or renew your registration with the Registrar General. Covers the full document pack.',
    requirementCount: 9,
    estimatedTime: '15 minutes to prepare',
    authority: 'Registrar General’s Department',
    turnaround: '7 to 14 working days',
    updatedAt: '2026-07-30',
    popularity: 'Popular',
  },
  {
    id: 'drivers-licence',
    name: "Driver's Licence",
    shortName: 'Licence',
    icon: 'driving',
    category: 'licensing',
    description:
      'Apply for a national driver’s licence, a renewal, or a replacement for a lost or damaged card.',
    requirementCount: 6,
    estimatedTime: '8 minutes to prepare',
    authority: 'National Driver and Vehicle Licensing Authority',
    turnaround: '21 working days',
    updatedAt: '2026-08-05',
    popularity: null,
  },
  {
    id: 'university-application',
    name: 'University Application',
    shortName: 'University',
    icon: 'university',
    category: 'education',
    description:
      'Collect transcripts, references and test scores for undergraduate and postgraduate programmes.',
    requirementCount: 8,
    estimatedTime: '20 minutes to prepare',
    authority: 'University admissions offices',
    turnaround: 'Varies by institution',
    updatedAt: '2026-08-22',
    popularity: 'Seasonal',
  },
  {
    id: 'national-id',
    name: 'National ID',
    shortName: 'National ID',
    icon: 'national-id',
    category: 'personal',
    description:
      'Enrol for a Ghana Card, replace an expired card, or update the personal details printed on it.',
    requirementCount: 5,
    estimatedTime: '6 minutes to prepare',
    authority: 'National Identification Authority',
    turnaround: '30 to 60 days',
    updatedAt: '2026-06-27',
    popularity: null,
  },
  {
    id: 'other-services',
    name: 'Other Services',
    shortName: 'Other',
    icon: 'general',
    category: 'other',
    description:
      'Not sure which list you need? Describe what you are applying for and we will build a checklist for you.',
    requirementCount: 4,
    estimatedTime: '3 minutes to prepare',
    authority: 'Varies',
    turnaround: 'Varies',
    updatedAt: '2026-08-12',
    popularity: null,
  },
]

export const PROCESSES_BY_ID = PROCESSES.reduce((accumulator, process) => {
  accumulator[process.id] = process
  return accumulator
}, {})

export function getProcessById(id) {
  return PROCESSES_BY_ID[id] ?? null
}
