import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../layouts/AppShell';
import { Card, CardHeader, Skeleton, EmptyState, Badge, Button } from '../../components/ui';
import { MomentumMeter } from '../../components/MomentumMeter';
import { LinkedInStepper } from '../../components/LinkedInStepper';
import { JobTable } from '../../components/JobTable';
import { DownloadButton, formatDate } from '../../components/files';

export default function ClientDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [resources, setResources] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // "me" resolves server-side to the caller's own profile — a client
        // never needs (or gets) anyone else's profile id.
        const { data: dash } = await api.get('/clients/me/dashboard');
        setData(dash);
        const [{ data: jobsRes }, { data: resRes }] = await Promise.all([
          api.get('/clients/me/jobs'),
          api.get('/interview-resources'),
        ]);
        setJobs(jobsRes.jobs);
        setResources(resRes.resources);
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [user]);

  const alertMode = Boolean(data?.expiry?.expiringSoon);

  if (error) {
    return (
      <AppShell>
        <EmptyState icon="⚠️" title="Could not load your dashboard" hint={error} />
      </AppShell>
    );
  }

  return (
    <AppShell alertMode={alertMode}>
      {!data ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* Expiry alert banner */}
          {alertMode && (
            <div
              className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-alert/40 bg-alert-soft px-6 py-4 animate-rise"
              role="alert"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">⏳</span>
                <div>
                  <div className="font-display text-lg text-alert">Time is almost up!</div>
                  <div className="text-sm text-ink">
                    Your {data.client.packageType} package expires in{' '}
                    <strong>{data.expiry.daysRemaining} day{data.expiry.daysRemaining === 1 ? '' : 's'}</strong>. Renew to keep your momentum.
                  </div>
                </div>
              </div>
              <Button variant="alert" onClick={() => window.open('mailto:Career@gethired.world?subject=Package renewal', '_blank')}>
                Renew now →
              </Button>
            </div>
          )}

          {/* Hero: Momentum Meter */}
          <section
            className={`relative overflow-hidden rounded-2xl p-8 sm:p-10 shadow-card-lg animate-rise ${
              alertMode ? 'bg-gradient-to-br from-navy-900 to-[#3d2410]' : 'bg-gradient-to-br from-navy-900 to-navy-800'
            }`}
          >
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold-500/10 blur-3xl" aria-hidden="true" />
            <div className="relative grid items-center gap-8 lg:grid-cols-2">
              <div>
                <div className="label-caps text-gold-300/80">This month's momentum</div>
                <h1 className="mt-2 font-display text-3xl sm:text-4xl text-ivory leading-tight">
                  Welcome back,<br />{data.client.fullName.split(' ')[0]}.
                </h1>
                <p className="mt-4 max-w-md text-ivory/70">
                  Our team has applied to{' '}
                  <strong className="text-gold-300">{data.momentum.applied} roles</strong> for you this
                  month — every one with a CV and cover letter tailored to the job.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Badge tone="gold">{data.client.packageType}</Badge>
                  {!alertMode && data.expiry.daysRemaining >= 0 && (
                    <Badge tone="navy">
                      <span className="text-ivory/90">{data.expiry.daysRemaining} days remaining</span>
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex justify-center lg:justify-end">
                <MomentumMeter
                  applied={data.momentum.applied}
                  target={data.momentum.target}
                  alertMode={alertMode}
                />
              </div>
            </div>
          </section>

          {/* LinkedIn tracker */}
          <Card className="mt-6 animate-rise animate-rise-1">
            <CardHeader
              title="LinkedIn Profile"
              subtitle="Our specialists are polishing your professional presence"
            />
            <div className="px-6 py-6 sm:px-10">
              <LinkedInStepper status={data.client.linkedinStatus} />
            </div>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Master documents */}
            <Card className="animate-rise animate-rise-2">
              <CardHeader
                title="Your Master Documents"
                subtitle="The foundation CVs & cover letters for each of your domains"
              />
              {data.domains.length === 0 ? (
                <EmptyState icon="📄" title="Being prepared" hint="Your strategy documents are on the way." />
              ) : (
                <ul className="divide-y divide-ivory-dark">
                  {data.domains.map((domain) => (
                    <li key={domain.id} className="px-6 py-4">
                      <div className="font-semibold text-navy-800">{domain.name}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {domain.masterDocuments.length === 0 && (
                          <span className="text-xs text-ink-soft">In production…</span>
                        )}
                        {domain.masterDocuments.map((doc) => (
                          <DownloadButton
                            key={doc.id}
                            docId={doc.id}
                            label={doc.type === 'master_cv' ? 'Master CV' : 'Master Cover Letter'}
                          />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Interview Prep Hub */}
            <Card className="animate-rise animate-rise-3">
              <CardHeader title="Interview Preparation Hub" subtitle="Guides and tips from our coaches" />
              {!resources ? (
                <div className="p-6 space-y-3">
                  <Skeleton className="h-16" /><Skeleton className="h-16" />
                </div>
              ) : resources.length === 0 ? (
                <EmptyState icon="🎓" title="Coming soon" hint="Interview resources will appear here." />
              ) : (
                <ul className="divide-y divide-ivory-dark">
                  {resources.map((r) => (
                    <li key={r.id} className="px-6 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-navy-800">{r.title}</div>
                          <p className="mt-0.5 text-sm text-ink-soft">{r.description}</p>
                          {r.tipText && (
                            <p className="mt-2 rounded-xl bg-gold-100/60 px-3.5 py-2.5 text-sm text-ink border-l-2 border-gold-500">
                              💡 {r.tipText}
                            </p>
                          )}
                        </div>
                        {r.hasFile && <DownloadButton docId={r.id} label="Download" />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Job list — safe columns only. No tailored files here, by design. */}
          <Card className="mt-6 animate-rise animate-rise-4">
            <CardHeader
              title="Where We've Applied For You"
              subtitle={`${jobs?.length ?? '…'} applications and counting`}
            />
            {!jobs ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" />
              </div>
            ) : (
              <JobTable jobs={jobs} showTailored={false} />
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
