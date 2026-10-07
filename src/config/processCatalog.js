const processes = {
  passport: {
    name: 'Passport Application',
    authority: 'Ghana Immigration Service',
    requirements: [
      ['identity-card', 'Ghana Card', 'identity-card', 'Clear scan of the front and back of your Ghana Card.', 'All four corners must be visible and the card must not be damaged or faded.', true],
      ['photograph', 'Passport Photograph', 'photograph', 'One recent passport photograph taken within the last six months.', 'White background, neutral expression, no glasses, 35mm by 45mm.', true],
      ['birth-certificate', 'Birth Certificate', 'birth-certificate', 'Certified copy issued by a registry office or the birth and death division.', 'A photocopy is not accepted. The certification stamp must be visible.', true],
      ['application-form', 'Application Form', 'application-form', 'Form GI-5, fully completed and signed by the applicant.', 'Sign in black ink. Leave no box blank, use N/A where it does not apply.', true],
      ['supporting-document', 'Supporting Document', 'supporting-document', 'Any document that supports the details on the application form.', 'A previous passport, national ID or marriage certificate works well.', true],
      ['proof-of-address', 'Proof of Address', 'proof-of-address', 'A utility bill or bank statement from the last three months.', 'The name on the bill must match the name on your application.', true],
      ['fee-receipt', 'Fee Receipt', 'fee-receipt', 'Proof of payment of the application fee.', 'Optional at the preparation stage. You can pay at the immigration office.', false]
    ]
  },
  'business-registration': {
    name: 'Business Registration',
    authority: 'Registrar General’s Department',
    requirements: [
      ['identity-card', "Director's Ghana Card", 'identity-card', 'Ghana Card for every director listed on the registration form.', 'A passport is accepted for directors who do not yet hold a Ghana Card.', true],
      ['application-form', 'Company Registration Form', 'application-form', 'Form A, completed for all directors and shareholders.', 'Shareholding percentages must add up to one hundred percent.', true],
      ['business-registration-certificate', 'Certificate of Incorporation', 'business-registration-certificate', 'Existing certificate when renewing, or the reserved name certificate for a new company.', 'Upload the current certificate so the registry can verify your company name.', true],
      ['company-constitution', 'Company Constitution', 'company-constitution', 'Signed constitution or incorporation documents for the company.', 'Use the constitution adopted at the first directors meeting.', true],
      ['tax-clearance', 'Tax Clearance Certificate', 'tax-clearance', 'Valid tax clearance certificate from the Ghana Revenue Authority.', 'Certificates older than twelve months are rejected.', true],
      ['bank-statement', 'Bank Account Confirmation', 'bank-statement', 'Bank confirmation letter for the company account.', 'The letter should be on bank letterhead and less than three months old.', true],
      ['proof-of-address', 'Proof of Registered Address', 'proof-of-address', 'Utility bill or lease for the registered office address.', 'The address must match the address on the registration form.', true],
      ['photograph', "Director's Passport Photograph", 'photograph', 'One passport photograph for each director.', 'Recent, white background and 35mm by 45mm.', true],
      ['supporting-document', 'Lease or Land Ownership', 'supporting-document', 'Proof that the company may occupy the registered address.', 'Optional. Only required when the office address is rented.', false]
    ]
  },
  'drivers-licence': {
    name: "Driver's Licence",
    authority: 'National Driver and Vehicle Licensing Authority',
    requirements: [
      ['identity-card', 'Ghana Card', 'identity-card', 'Current Ghana Card used to verify your identity.', 'The card must still be within its validity period.', true],
      ['application-form', "Driver's Licence Form", 'application-form', 'Application form for a new licence, renewal or replacement.', 'Tick the correct box for new, renewal or replacement.', true],
      ['photograph', 'Passport Photograph', 'photograph', 'Recent passport photograph for the licence card.', 'White background, no head covering unless for medical reasons.', true],
      ['medical-report', 'Medical Report', 'medical-report', 'Vision and fitness report from an approved clinic.', 'The clinic must be on the authority approved list.', true],
      ['proof-of-address', 'Proof of Address', 'proof-of-address', 'Recent utility bill showing your current address.', 'Dated within the last three months.', true],
      ['examination-certificate', 'Examination Certificate', 'supporting-document', 'Certificate from the driving school for new applicants.', 'Renewals and replacements do not need this document.', true]
    ]
  },
  'university-application': {
    name: 'University Application',
    authority: 'University admissions offices',
    requirements: [
      ['identity-card', 'Ghana Card', 'identity-card', 'Identity document matching your application form.', 'Your name must match the name on every submitted document.', true],
      ['application-form', 'University Application Form', 'application-form', 'The online application form, downloaded as a PDF.', 'Submit the PDF generated after you complete the online form.', true],
      ['test-results', 'Wafer Results', 'test-results', 'Secondary school leaving certificate results.', 'Include the index number so the admissions office can verify it.', true],
      ['transcript', 'Secondary School Transcript', 'transcript', 'Continuous assessment transcript for senior high school.', 'Stamped by the school and signed by the head of school.', true],
      ['supporting-document', 'Statement of Purpose', 'supporting-document', 'A short essay explaining why you chose the programme.', 'Usually limited to one page, 400 words maximum.', true],
      ['reference-letter-1', 'Academic Reference', 'recommendation-letter', 'Reference from a teacher or tutor at your previous school.', 'Must be printed on school letterhead and signed.', true],
      ['reference-letter-2', 'Second Reference', 'recommendation-letter', 'A second referee who can speak to your character and readiness.', 'Optional for most programmes but strongly recommended.', false],
      ['photograph', 'Passport Photograph', 'photograph', 'Recent photograph for the student identity card.', 'Same specification as a passport photograph.', true]
    ]
  },
  'national-id': {
    name: 'National ID',
    authority: 'National Identification Authority',
    requirements: [
      ['birth-certificate', 'Birth Certificate', 'birth-certificate', 'Certified copy of your birth certificate.', 'The certificate must carry a registry certification stamp.', true],
      ['application-form', 'National ID Application Form', 'application-form', 'The enrolment form completed and signed.', 'Sign in the boxes marked for the applicant and a witness.', true],
      ['identity-card', 'Existing ID (if any)', 'identity-card', 'Your previous ID card, if you already hold one.', 'Leave this out when applying for a first national ID.', false],
      ['proof-of-address', 'Proof of Residence', 'proof-of-address', 'Document confirming where you currently live.', 'A utility bill, tenancy agreement or school letter works.', true],
      ['photograph', 'Passport Photograph', 'photograph', 'Recent photograph for the enrolment record.', 'White background, taken within the last six months.', true]
    ]
  },
  'other-services': {
    name: 'Other Services',
    authority: 'Varies',
    requirements: [
      ['application-form', 'Application Form', 'application-form', 'The form supplied by the office you are applying to.', 'Download the latest version before you start filling it in.', true],
      ['photograph', 'Passport Photograph', 'photograph', 'Two recent passport photographs.', 'Ask the office whether one or two photographs are required.', true],
      ['supporting-document', 'Supporting Document', 'supporting-document', 'Any document that proves your eligibility.', 'Add the document that the office asked you to bring.', true],
      ['identity-card', 'Proof of Identity', 'identity-card', 'Any national identity document you hold.', 'A voter card or national ID card is usually accepted.', true]
    ]
  }
};

const processCatalog = Object.fromEntries(Object.entries(processes).map(([id, process]) => [
  id,
  {
    id,
    name: process.name,
    authority: process.authority,
    requirements: process.requirements.map(([key, name, type, description, guidance, isRequired]) => ({
      key,
      name,
      type,
      description,
      guidance,
      isRequired
    }))
  }
]));

function getProcess(processId) {
  return processCatalog[processId] ?? null;
}

module.exports = {
  getProcess,
  processCatalog
};
