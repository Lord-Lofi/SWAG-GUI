import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';

// Health of one SWAG instance: the SWAG image and its age (nginx, PHP and
// certbot only update with a new image), HTTP/2 / HTTP/3, and the
// certificate. Read-only, except for the renewal check, which runs SWAG's
// own renewal script.
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

function ImageCard({ image, nginx, php }) {
  const tone = image.state === 'ok' ? 'ok' : image.state === 'old' ? 'warning' : 'unknown';
  return (
    <Card title="SWAG image" tone={tone}>
      <p className="font-mono text-lg">{image.version ?? 'Unknown version'}</p>
      {image.built && (
        <p className="text-xs mt-1">
          Built {new Date(image.built).toLocaleDateString()} ({image.ageDays === 0 ? 'today' : `${image.ageDays} day${image.ageDays === 1 ? '' : 's'} ago`})
        </p>
      )}
      {image.state === 'old' && (
        <p className="text-xs mt-1">
          linuxserver.io rebuilds SWAG at least weekly, and security fixes for nginx and PHP arrive that way. This one is over a month old.
        </p>
      )}
      <p className="text-xs text-gray-400 mt-2">
        nginx <span className="font-mono">{nginx ?? 'not found'}</span> · PHP <span className="font-mono">{php ?? 'not found'}</span>
      </p>
      {image.reference && <p className="font-mono text-[11px] text-gray-500 mt-1 break-all">{image.reference}</p>}
      <p className="text-[11px] text-gray-500 mt-2">
        To update: <span className="font-mono">docker compose pull swag &amp;&amp; docker compose up -d swag</span>
      </p>
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
      <div className="grid gap-3 md:grid-cols-3">
        <ImageCard image={data.image} nginx={data.nginx} php={data.php} />
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
