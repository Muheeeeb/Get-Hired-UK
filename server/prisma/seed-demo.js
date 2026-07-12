import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(__dirname, '../uploads');

const PASSWORD = 'GetHired2026!';

function dateOnly(iso) {
  return new Date(`${iso}T00:00:00.000Z`);
}
function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

async function writeUpload(key, content) {
  const filePath = path.join(UPLOADS, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return key;
}

function masterCvText(name, domain) {
  return `MASTER CV — ${name}
Target domain: ${domain}

PROFILE
Accomplished ${domain} professional with 8+ years of experience delivering high-impact results across fast-moving organisations in the UK market.

KEY ACHIEVEMENTS
- Led a cross-functional team of 12 to deliver a flagship programme 3 weeks ahead of schedule
- Improved core process efficiency by 34% through data-driven analysis and automation
- Managed stakeholder relationships across engineering, product, and executive teams
- Mentored 6 junior colleagues, 4 of whom earned promotions within 18 months

EXPERIENCE
Senior ${domain} — Meridian Group, London (2021–present)
${domain} — Northgate Partners, Manchester (2018–2021)

EDUCATION
BSc (Hons), University of Leeds

SKILLS
Leadership · Stakeholder management · Delivery · Analysis · Communication
`;
}

function coverLetterText(name, domain) {
  return `MASTER COVER LETTER — ${name} (${domain})

Dear Hiring Manager,

I am an experienced ${domain} professional writing to express my interest in opportunities within your organisation. Over the past eight years I have built a track record of delivering measurable results, leading teams, and driving improvement.

I would welcome the chance to bring that experience to your team.

Yours faithfully,
${name}
`;
}

const COMPANIES = [
  'Barclays', 'Monzo', 'Revolut', 'Deloitte UK', 'BT Group', 'Sky', 'Ocado Technology',
  'Sainsbury’s Tech', 'Lloyds Banking Group', 'Starling Bank', 'Wise', 'Checkout.com',
  'Deliveroo', 'BBC', 'AstraZeneca', 'Rolls-Royce', 'Vodafone', 'Capgemini UK',
  'Accenture UK', 'JP Morgan London', 'HSBC', 'NatWest Group', 'Trainline', 'Zopa Bank',
];

async function main() {
  console.log('Seeding…');

  // Wipe in dependency order (idempotent reseed).
  await prisma.dailyPulseLog.deleteMany();
  await prisma.tailoredDocument.deleteMany();
  await prisma.jobApplication.deleteMany();
  await prisma.masterDocument.deleteMany();
  await prisma.domain.deleteMany();
  await prisma.interviewResource.deleteMany();
  await prisma.clientProfile.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash(PASSWORD, 12);

  const admin = await prisma.user.create({
    data: { fullName: 'Amelia Whitmore', email: 'admin@gethired.uk', passwordHash: hash, role: 'admin' },
  });
  const emp1 = await prisma.user.create({
    data: { fullName: 'Daniel Okafor', email: 'daniel@gethired.uk', passwordHash: hash, role: 'employee' },
  });
  const emp2 = await prisma.user.create({
    data: { fullName: 'Priya Sharma', email: 'priya@gethired.uk', passwordHash: hash, role: 'employee' },
  });

  const clientSpecs = [
    {
      fullName: 'James Holloway',
      email: 'james@client.co.uk',
      packageType: 'Platinum — 40 jobs/month',
      expiryDays: 64,
      target: 40,
      employee: emp1,
      linkedin: 'in_progress',
      domains: ['Software Engineer', 'Tech Lead', 'Engineering Manager', 'Platform Engineer'],
      jobsThisMonth: 24,
    },
    {
      fullName: 'Sofia Reyes',
      email: 'sofia@client.co.uk',
      packageType: 'Gold — 30 jobs/month',
      expiryDays: 5, // demos the orange expiry alert
      target: 30,
      employee: emp1,
      linkedin: 'complete',
      domains: ['Product Manager', 'Product Owner', 'Delivery Manager'],
      jobsThisMonth: 21,
    },
    {
      fullName: 'Oliver Bennett',
      email: 'oliver@client.co.uk',
      packageType: 'Platinum — 40 jobs/month',
      expiryDays: 41,
      target: 40,
      employee: emp2,
      linkedin: 'not_started',
      domains: ['Data Analyst', 'Data Engineer', 'BI Developer', 'Analytics Consultant'],
      jobsThisMonth: 24,
    },
  ];

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const dayOfMonth = today.getDate();

  for (const spec of clientSpecs) {
    const user = await prisma.user.create({
      data: { fullName: spec.fullName, email: spec.email, passwordHash: hash, role: 'client' },
    });
    const profile = await prisma.clientProfile.create({
      data: {
        userId: user.id,
        assignedEmployeeId: spec.employee.id,
        packageType: spec.packageType,
        expiryDate: dateOnly(isoDaysFromNow(spec.expiryDays)),
        linkedinStatus: spec.linkedin,
        monthlyJobTarget: spec.target,
      },
    });

    // Domains + master docs (real .txt files so the AI assistant can read them).
    for (const domainName of spec.domains) {
      const domain = await prisma.domain.create({
        data: { clientId: profile.id, name: domainName },
      });
      const slug = domainName.toLowerCase().replace(/\s+/g, '-');
      const cvKey = await writeUpload(
        `masters/${profile.id}/seed-${slug}-cv.txt`,
        masterCvText(spec.fullName, domainName)
      );
      const clKey = await writeUpload(
        `masters/${profile.id}/seed-${slug}-cover-letter.txt`,
        coverLetterText(spec.fullName, domainName)
      );
      await prisma.masterDocument.create({
        data: {
          domainId: domain.id, type: 'master_cv', fileKey: cvKey,
          fileName: `${spec.fullName.split(' ')[0]} — Master CV (${domainName}).txt`,
          uploadedById: spec.employee.id,
        },
      });
      await prisma.masterDocument.create({
        data: {
          domainId: domain.id, type: 'master_cover_letter', fileKey: clKey,
          fileName: `${spec.fullName.split(' ')[0]} — Master Cover Letter (${domainName}).txt`,
          uploadedById: spec.employee.id,
        },
      });
    }

    // Job applications spread across this month, a few logged today.
    for (let i = 0; i < spec.jobsThisMonth; i++) {
      const company = COMPANIES[(i * 7 + spec.fullName.length) % COMPANIES.length];
      const domainName = spec.domains[i % spec.domains.length];
      // Spread over days 1..today, with the last 3 jobs today (for the Daily Pulse demo).
      const day = i >= spec.jobsThisMonth - 3 ? dayOfMonth : 1 + ((i * 3) % Math.max(1, dayOfMonth - 1));
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const job = await prisma.jobApplication.create({
        data: {
          clientId: profile.id,
          employeeId: spec.employee.id,
          jobTitle: `${domainName}`,
          company,
          applicationDate: dateOnly(iso),
          jobUrl: `https://uk.indeed.com/viewjob?jk=${Buffer.from(`${company}-${i}`).toString('hex').slice(0, 12)}`,
        },
      });

      // Tailored docs for each job — the files clients must NEVER see.
      const tCvKey = await writeUpload(
        `tailored/${profile.id}/${job.id}/tailored-cv.txt`,
        `TAILORED CV for ${job.jobTitle} at ${company}\nCandidate: ${spec.fullName}\n(Confidential — internal only)`
      );
      const tClKey = await writeUpload(
        `tailored/${profile.id}/${job.id}/tailored-cover-letter.txt`,
        `TAILORED COVER LETTER for ${job.jobTitle} at ${company}\nCandidate: ${spec.fullName}\n(Confidential — internal only)`
      );
      await prisma.tailoredDocument.create({
        data: {
          jobApplicationId: job.id, type: 'tailored_cv', fileKey: tCvKey,
          fileName: `Tailored CV — ${company}.txt`, uploadedById: spec.employee.id,
        },
      });
      await prisma.tailoredDocument.create({
        data: {
          jobApplicationId: job.id, type: 'tailored_cover_letter', fileKey: tClKey,
          fileName: `Tailored Cover Letter — ${company}.txt`, uploadedById: spec.employee.id,
        },
      });
    }
  }

  // Interview Prep Hub content.
  const guideKey = await writeUpload(
    'resources/interview-guide.txt',
    `GET HIRED UK — THE INTERVIEW GUIDE

1. Research the company: mission, products, recent news.
2. Prepare STAR stories for your top 6 achievements.
3. Rehearse answers aloud — twice minimum.
4. Prepare 3 intelligent questions for your interviewer.
5. Follow up within 24 hours with a short thank-you note.
`
  );
  await prisma.interviewResource.create({
    data: {
      title: 'The Interview Guide',
      description: 'Our complete playbook: preparation, STAR stories, and follow-up strategy.',
      fileKey: guideKey,
      fileName: 'Get Hired UK — Interview Guide.txt',
      createdById: admin.id,
    },
  });
  await prisma.interviewResource.create({
    data: {
      title: 'The 90-Second Introduction',
      description: 'How to open any interview with confidence.',
      tipText:
        'Structure your opener: who you are (10s), your strongest achievement (30s), why this role (30s), and an invitation back ("happy to go deeper on any of that"). Rehearse until it sounds unrehearsed.',
      createdById: admin.id,
    },
  });
  await prisma.interviewResource.create({
    data: {
      title: 'Salary Negotiation Basics',
      description: 'Never leave money on the table.',
      tipText:
        'Never give the first number. When asked for expectations, respond: "I’d like to understand the full scope of the role first — what range has been budgeted?" Anchor on the top third of their range.',
      createdById: admin.id,
    },
  });

  console.log('Seed complete.');
  console.log(`  Login password for ALL demo accounts: ${PASSWORD}`);
  console.log('  admin@gethired.uk (admin)');
  console.log('  daniel@gethired.uk, priya@gethired.uk (employees)');
  console.log('  james@client.co.uk, sofia@client.co.uk (expires in 5 days!), oliver@client.co.uk (clients)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
