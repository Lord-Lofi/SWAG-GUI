import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';

// Health of one SWAG instance: software versions against known security
// fixes, HTTP/2 / HTTP/3, and the certificate. Read-only, except for the
// renewal check, which runs SWAG's own renewal script.
const TONE = {
  ok:      'border-green-900 bg-green-950/40 text-green-300',
  warning: 'border-amber-800 bg-amber-950/40 text-amber-300',
  bad:     'border-red-900 bg-red-950/50 text-red-300',
  unknown: 'border-gray-800 bg-gray-900 text-gray-400',
};

function Card({ title, tone = 'unknown', children }) {
  return (
    <section className={`rounded-sm border p-4 ${TONE[tone]}`}>
      <h3 className="text-xs uppercase tracking-wide opacity-80 mb-2">{title}</h3>
      <div className="text-sm text-gray-200">{children}</div>
    </section>
  );
}

function VersionCard({ name, info, checkedAgainst }) {
  const tone = info.ok === null ? 'unknown' : info.ok ? 'ok' : 'bad';
  return (
    <Card title={name} tone={tone}>
      {info.version === null ? (
        <p className="text-gray-400">Not found in this container.</p>
      ) : (
        <>
          <p className="font-mono text-lg">{info.version}</p>
          <p className="text-xs mt-1">
            {info.ok
              ? `Includes the latest known security fixes (as of ${checkedAgainst}).`
              : `Vulnerable: update to ${info.fixedIn} or newer. Pull the latest SWAG image and recreate the container.`}
          </p>
          <p className="text-[11px] text-gray-500 mt-1">{info.advisory}</p>
        </>
      )}
    </Card>
  );
}

export default function StatusPanel({ instanceId }) {
  const [data, setData]         = useState(null);
  const [error, setError]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [renewing, setRenewing] = useState(false);
  const [renewOut, setRenewOut] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.status.get(instanceId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    setData(null);
    setRenewOut(null);
    load();
  }, [load]);

  async function handleRenew() {
    setRenewing(true);
    setRenewOut(null);
    try {
      const r = await api.status.renew(instanceId);
      setRenewOut({ ok: true, text: r.output || 'Renewal check finished.' });
    } catch (err) {
      setRenewOut({ ok: false, text: `${err.message}${err.data?.output ? `\n\n${err.data.output}` : ''}` });
    } finally {
      setRenewing(false);
      load();
    }
  }

  if (loading && !data) return <p className="text-gray-600 text-sm mt-4">Checking…</p>;
  if (error) return <p className="text-red-300 text-sm mt-4">Couldn't read the status: {error}</p>;
  if (!data) return null;

  const cert = data.certificate;
  const certTone = !cert ? 'unknown' : cert.state === 'ok' ? 'ok' : cert.state === 'warning' ? 'warning' : 'bad';
  const p = data.protocols;

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <VersionCard name="nginx" info={data.nginx} checkedAgainst={data.checkedAgainst} />
        <VersionCard name="PHP" info={data.php} checkedAgainst={data.checkedAgainst} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Protocols" tone={p ? 'unknown' : 'warning'}>
          {p ? (
            <ul className="space-y-1">
              <li>HTTP/2: <span className="font-medium">{p.http2 ? 'on' : 'off'}</span></li>
              <li>HTTP/3 (QUIC): <span className="font-medium">{p.http3 ? 'on' : 'off'}</span></li>
              <li className="text-[11px] text-gray-500 pt-1">
                Useful during an incident: several nginx flaws only affect sites with HTTP/2 or HTTP/3 on.
              </li>
            </ul>
          ) : (
            <p>Couldn't read nginx's configuration.</p>
          )}
        </Card>

        <Card title="Certificate" tone={certTone}>
          {cert ? (
            <>
              <p>
                {cert.state === 'expired' ? 'Expired' : 'Expires'}{' '}
                <span className="font-medium">{new Date(cert.expires).toLocaleDateString()}</span>
                {cert.state !== 'expired' && <> ({cert.daysLeft} days left)</>}
              </p>
              {cert.state === 'warning' && (
                <p className="text-xs mt-1">Renewal normally happens with 30 days left, so it may be failing. Run a check below and read the output.</p>
              )}
              <p className="text-xs text-gray-400 mt-1">Issued by {cert.issuer ?? 'unknown'}</p>
              <p className="font-mono text-xs text-gray-400 mt-1 break-all">{cert.domains.join(', ')}</p>
            </>
          ) : (
            <p>{data.certError}</p>
          )}
          {data.canRenew && (
            <button
              onClick={handleRenew}
              disabled={renewing}
              title="Runs SWAG's own renewal script. Certificates are only renewed when due."
              className="mt-3 px-3 py-1 rounded-sm text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 disabled:opacity-40"
            >
              {renewing ? 'Checking… (can take a minute)' : 'Run renewal check'}
            </button>
          )}
        </Card>
      </div>

      {renewOut && (
        <pre className={`rounded-sm border p-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto ${renewOut.ok ? 'border-gray-800 bg-gray-950 text-gray-300' : 'border-red-800 bg-red-950 text-red-300'}`}>
          {renewOut.text}
        </pre>
      )}

      <div>
        <button onClick={load} disabled={loading} className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-40">
          {loading ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </div>
  );
}
