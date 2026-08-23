const { PrismaClient } = require('../generated/prisma');
const { PrismaNeon } = require('@prisma/adapter-neon');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Demo password for every seeded doctor — printed at the end so whoever
// runs the seed can log in immediately. Real signups go through /api/auth/signup.
const DEMO_PASSWORD = 'demo1234';

const doctors = [
  { id: 'doc-1', name: 'Dr. Anjali Rao', email: 'anjali.rao@demo-hospital.test', specialty: 'General Medicine' },
  { id: 'doc-2', name: 'Dr. Vikram Sen', email: 'vikram.sen@demo-hospital.test', specialty: 'Internal Medicine' },
  { id: 'doc-3', name: 'Dr. Priya Nair', email: 'priya.nair@demo-hospital.test', specialty: 'Family Medicine' },
];

const patients = [
  {
    id: 'pat-1',
    name: 'Ramesh Iyer',
    age: 58,
    priorVisitSummary:
      'Hypertension, on Amlodipine 5mg since 2023. Last BP reading 138/88. Advised low-sodium diet, follow-up in 3 months.',
  },
  {
    id: 'pat-2',
    name: 'Sunita Verma',
    age: 34,
    priorVisitSummary:
      'Type 2 diabetes diagnosed 2022, on Metformin 500mg BD. HbA1c last checked 7.1%. No prior complications reported.',
  },
  {
    id: 'pat-3',
    name: 'Arjun Malhotra',
    age: 45,
    priorVisitSummary:
      'First visit for recurring lower back pain, ~6 weeks duration. No prior chronic conditions on file.',
  },
  {
    id: 'pat-4',
    name: 'Fatima Sheikh',
    age: 27,
    priorVisitSummary:
      'Seasonal allergic rhinitis, managed with antihistamines PRN. No other significant history.',
  },
];

async function main() {
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  for (const d of doctors) {
    await prisma.doctor.upsert({
      where: { id: d.id },
      update: { name: d.name, email: d.email, specialty: d.specialty },
      create: { ...d, passwordHash },
    });
  }
  for (const p of patients) {
    await prisma.patient.upsert({ where: { id: p.id }, update: p, create: p });
  }

  const defaultTemplateId = 'tpl-default';
  await prisma.dischargeTemplate.upsert({
    where: { id: defaultTemplateId },
    update: {},
    create: {
      id: defaultTemplateId,
      name: 'Standard Discharge Summary (default)',
      uploadedById: doctors[0].id,
      templateText: [
        'DISCHARGE SUMMARY',
        '',
        'Patient: {{patient_name}}, Age {{patient_age}}',
        'Attending physician: {{doctor_name}}',
        'Date: {{date}}',
        '',
        'Diagnosis: {{diagnosis}} ({{icd10}})',
        'Presenting symptoms: {{symptoms}}',
        '',
        'Discharge medications: {{medications}}',
        '',
        'Follow-up instructions: {{followup_instructions}}',
      ].join('\n'),
    },
  });

  console.log(`Seeded ${doctors.length} doctors, ${patients.length} patients, and a default discharge template.`);
  console.log(`\nDemo login credentials (all seeded doctors share this password):`);
  doctors.forEach((d) => console.log(`  ${d.email}  /  ${DEMO_PASSWORD}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
