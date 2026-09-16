import { useEffect, useMemo, useState } from 'react';

interface TraceEvent {
  at: number;
  source: 'alice' | 'bob';
  kind: string;
  title: string;
  data?: unknown;
}

interface Identity {
  domain: string;
  kid?: string;
  record: Record<string, string> | null;
}

const PROMPTS = [
  [
    'Who is Bob?',
    'Use the dnsid verify tool on bob.dev.dnsid.test. Say in one sentence who he is and whether he may be called, and stop.',
  ],
  [
    'GET Bob',
    'Use the dnsid fetch tool to GET https://bob.dev.dnsid.test/. Quote the response body, or the denial reason, and stop.',
  ],
  [
    'POST Bob',
    'Use the dnsid fetch tool to POST {"hello":"bob"} to https://bob.dev.dnsid.test/ as application/json. Quote the response body and stop.',
  ],
  [
    'Call Carol',
    'Use the dnsid fetch tool to GET https://carol.dev.dnsid.test/. Quote the response body, or the denial reason, and stop.',
  ],
] as const;

// EventSource reconnects on error, but a server restart behind the dev proxy
// can leave a silent dead connection; the server pings every 10s, so 30s of
// silence means reconnect.
function useEvents(url: string, onEvent: (e: TraceEvent) => void) {
  useEffect(() => {
    let source: EventSource;
    let watchdog: ReturnType<typeof setTimeout>;
    const open = () => {
      source = new EventSource(url);
      const alive = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          source.close();
          open();
        }, 30_000);
      };
      source.onopen = alive;
      source.addEventListener('ping', alive);
      source.onmessage = (m) => {
        alive();
        onEvent(JSON.parse(m.data));
      };
    };
    open();
    return () => {
      clearTimeout(watchdog);
      source.close();
    };
  }, [url]);
}

function useIdentity(url: string) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(url)
        .then((r) => r.json())
        .then(setIdentity, () => setIdentity(null));
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [url]);
  return identity;
}

function short(value: string | undefined, n = 18) {
  return value && value.length > n ? `${value.slice(0, n)}…` : (value ?? '');
}

function AgentCard({
  name,
  identity,
  children,
}: {
  name: string;
  identity: Identity | null;
  children?: React.ReactNode;
}) {
  const record = identity?.record;
  return (
    <section className="card">
      <h2>{name}</h2>
      {!identity && <div className="idle">not running</div>}
      {identity && (
        <>
          <div className="domain">{identity.domain}</div>
          <span className={`pill ${record ? 'ok' : 'bad'}`}>
            {record ? '_dnsid record in DNS' : 'no _dnsid record'}
          </span>
          <dl>
            {identity.kid && (
              <>
                <dt>operational key</dt>
                <dd>{short(identity.kid)}</dd>
              </>
            )}
            {record &&
              ['v', 'gi', 'ku', 'su', 'ek', 'lr', 'sg'].map((k) =>
                record[k] ? (
                  <>
                    <dt key={`${k}-t`}>{k}</dt>
                    <dd key={`${k}-d`} title={record[k]}>
                      {short(record[k], 48)}
                    </dd>
                  </>
                ) : null,
              )}
          </dl>
        </>
      )}
      {children}
    </section>
  );
}

// RFC 9421: sig1=("@method" "@authority" ...);keyid="...";alg="...";created=...
function parseSignatureInput(value: string) {
  const m = /^\w+=\(([^)]*)\)(.*)$/.exec(value);
  if (!m) return null;
  const covered = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const params = Object.fromEntries(
    [...m[2].matchAll(/;(\w+)=("?)([^;"]*)\2/g)].map((x) => [x[1], x[3]]),
  );
  return { covered, params };
}

function Wire({ request }: { request: TraceEvent | undefined }) {
  const data = request?.data as
    | { method: string; url: string; headers: Record<string, string>; body?: string }
    | undefined;
  const sigInput = data?.headers['signature-input'];
  const parsed = sigInput ? parseSignatureInput(sigInput) : null;
  return (
    <section className="card wire">
      <h2>On the wire, as Bob receives it</h2>
      {!data && <div className="idle">No request yet. Ask Alice to call Bob.</div>}
      {data && (
        <>
          <div className="method">
            {data.method} {data.url}
          </div>
          {Object.entries(data.headers)
            .filter(
              ([k]) =>
                ![
                  'host',
                  'connection',
                  'accept-encoding',
                  'user-agent',
                  'x-forwarded-for',
                  'x-forwarded-proto',
                  'x-forwarded-host',
                  'x-real-ip',
                  'content-length',
                ].includes(k),
            )
            .map(([k, v]) => (
              <div
                key={k}
                className={`header-line ${k.startsWith('signature') || k === 'content-digest' ? 'sig' : ''}`}
              >
                <b>{k}</b>: {v}
              </div>
            ))}
          {data.body && <div className="header-line">{data.body}</div>}
          {parsed && (
            <>
              <p style={{ margin: '12px 0 0' }}>
                Signed by <code>{parsed.params.keyid}</code> with{' '}
                <code>{parsed.params.alg}</code>. The signature covers:
              </p>
              <ul className="covered">
                {parsed.covered.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {!parsed && (
            <p className="idle" style={{ marginTop: 12 }}>
              No signature. A GET needs none; Bob answers anyone.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Timeline({ events }: { events: TraceEvent[] }) {
  const t0 = events[0]?.at ?? 0;
  return (
    <div className="timeline">
      {events.map((e, i) => (
        <div key={i} className={`event ${e.source} ${e.kind}`}>
          <span className="t">+{((e.at - t0) / 1000).toFixed(1)}s</span>
          <span className="who">{e.source}</span>
          {e.data === undefined ? (
            <span className="title">{e.title}</span>
          ) : (
            <details>
              <summary className="title">{e.title}</summary>
              <pre>
                {typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  // A reconnect replays the server's history, so an event may arrive twice.
  const add = (e: TraceEvent) =>
    setEvents((prev) =>
      prev.some((p) => p.at === e.at && p.source === e.source && p.title === e.title)
        ? prev
        : [...prev, e].sort((a, b) => a.at - b.at),
    );
  useEvents('/alice/events', add);
  useEvents('/bob/events', add);
  const alice = useIdentity('/alice/identity');
  const bob = useIdentity('/bob/identity');
  const [custom, setCustom] = useState('');

  const lastRequest = useMemo(
    () => [...events].reverse().find((e) => e.kind === 'request'),
    [events],
  );
  const lastVerdict = useMemo(
    () =>
      [...events].reverse().find((e) => e.kind === 'verified' || e.kind === 'rejected'),
    [events],
  );
  const busy = useMemo(() => {
    const last = [...events]
      .reverse()
      .find(
        (e) =>
          e.source === 'alice' &&
          (e.kind === 'prompt' || e.kind === 'done' || e.kind === 'error'),
      );
    return last?.kind === 'prompt';
  }, [events]);

  const send = (prompt: string) =>
    fetch('/alice/prompt', { method: 'POST', body: JSON.stringify({ prompt }) });

  return (
    <div className="app">
      <header>
        <h1>
          <span>DNSid</span> · two agents, one signed request
        </h1>
        <span className="wordmark">innovation labs</span>
      </header>

      <div className="stage">
        <AgentCard name="Alice · Agent SDK + plugin" identity={alice}>
          <p style={{ marginTop: 12 }}>
            {busy ? (
              <span className="pill busy">thinking</span>
            ) : (
              <span className="pill">idle</span>
            )}
          </p>
        </AgentCard>
        <Wire request={lastRequest} />
        <AgentCard name="Bob · verifies who calls" identity={bob}>
          {lastVerdict && (
            <p style={{ marginTop: 12 }}>
              <span className={`pill ${lastVerdict.kind === 'verified' ? 'ok' : 'bad'}`}>
                {lastVerdict.title}
              </span>
            </p>
          )}
        </AgentCard>
      </div>

      <div className="prompts">
        {PROMPTS.map(([label, prompt]) => (
          <button
            key={label}
            className="primary"
            disabled={busy}
            onClick={() => send(prompt)}
          >
            {label}
          </button>
        ))}
        <input
          className="prompt"
          placeholder="or ask Alice anything…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              send(custom.trim());
              setCustom('');
            }
          }}
        />
        <button onClick={() => setEvents([])}>clear</button>
      </div>

      <Timeline events={events} />
    </div>
  );
}
