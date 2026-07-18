/**
 * SINGLE SOURCE OF TRUTH for the service packages.
 * The public landing page, the admin portal, and any future surface read this
 * via GET /public/packages — edit here and every display stays consistent.
 */
export const PACKAGES = [
  {
    key: 'silver',
    name: 'Silver',
    tag: 'The essentials',
    features: ['Tailored CV (3–4 domains)', 'Tailored cover letters'],
  },
  {
    key: 'gold',
    name: 'Gold',
    tag: 'Add your profile',
    features: ['Tailored CV (3–4 domains)', 'Tailored cover letters', 'LinkedIn optimisation'],
  },
  {
    key: 'platinum',
    name: 'Platinum',
    tag: 'Everything, at pace',
    popular: true,
    applicationsPerWeek: 80,
    features: [
      'Tailored CV (3–4 domains)',
      'Tailored cover letters',
      'LinkedIn optimisation',
      'Interview Preparation Hub',
    ],
    sub: [
      '1 interview prep session',
      '1 mock interview',
      'Tailored prep report for your scheduled interview',
    ],
  },
  {
    key: 'interview-prep',
    name: 'Interview Prep',
    tag: 'Standalone',
    standalone: true,
    features: ['5 interview prep sessions', '2 mock interviews'],
  },
];

/** Suggested values for admin package dropdowns. */
export const PACKAGE_CHOICES = PACKAGES.map((p) =>
  p.applicationsPerWeek ? `${p.name} — ${p.applicationsPerWeek}+ jobs/week` : p.name
);
