import { Card, CardHeader } from './ui';
import { formatDate } from './files';

function Detail({ label, children }) {
  return (
    <div>
      <dt className="label-caps text-ink-soft">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-navy-800">{children || 'Not provided'}</dd>
    </div>
  );
}

/** Read-only client information supplied from the client's Account form. */
export function ClientPersonalDetails({ client, className = '' }) {
  return (
    <Card className={className}>
      <CardHeader
        title="Personal Details"
        subtitle="Information supplied by the client in their Account"
      />
      <dl className="grid gap-x-6 gap-y-5 p-6 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Date of birth">{client.dateOfBirth ? formatDate(client.dateOfBirth) : null}</Detail>
        <Detail label="NI number">{client.niNumber}</Detail>
        <Detail label="Visa status">{client.visaStatus}</Detail>
        <Detail label="Visa expiry date">{client.visaExpiryDate ? formatDate(client.visaExpiryDate) : null}</Detail>
        <Detail label="Phone number">
          {client.phone ? <a className="hover:underline" href={`tel:${client.phone}`}>{client.phone}</a> : null}
        </Detail>
        <Detail label="Postcode">{client.postcode}</Detail>
        <div className="sm:col-span-2 lg:col-span-3">
          <Detail label="Residential address">{client.residentialAddress}</Detail>
        </div>
        {client.country && <Detail label="Country">{client.country}</Detail>}
        {client.notes && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Detail label="Additional notes">{client.notes}</Detail>
          </div>
        )}
      </dl>
    </Card>
  );
}
