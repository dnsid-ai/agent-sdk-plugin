import { useEffect, useMemo, useRef, useState } from 'react';

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

/** One question to Alice and everything that happened because of it. */
interface Turn {
  prompt: TraceEvent;
  events: TraceEvent[];
  done: boolean;
}

const PROMPTS = [
  [
    'Who is Bob?',
    'Use the dnsid verify tool on bob.dev.dnsid.test. Say in one sentence who he is and whether he may be called, and stop.',
  ],
  [
    'Say hello to Bob',
    'Use the dnsid fetch tool to POST {"hello":"bob"} to https://bob.dev.dnsid.test/ as application/json. Quote the response body and stop.',
  ],
  [
    'Call Carol',
    'Use the dnsid fetch tool to GET https://carol.dev.dnsid.test/. Quote the response body, or the denial reason, and stop.',
  ],
] as const;

// The four steps of verification, and which failure code lands on which.
const STEPS = ['DNS record', 'Keys and signature', 'Status', 'Transparency log'];
const FAILING_STEP: Record<string, number> = {
  DNSResolution: 0,
  DNSSECFailed: 0,
  RecordInvalid: 1,
  SignatureInvalid: 1,
  TLSError: 1,
  KeyAgeExceeded: 1,
  StatusUnavailable: 2,
  StatusNotActive: 2,
  LogError: 3,
  CounterpartyNotAccepted: 3,
};

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

function turnsOf(events: TraceEvent[]): Turn[] {
  const turns: Turn[] = [];
  for (const e of events) {
    if (e.source === 'alice' && e.kind === 'prompt') {
      turns.push({ prompt: e, events: [], done: false });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn) continue;
    if (e.kind === 'done' || e.kind === 'error') turn.done = true;
    // The hook's allow is only known once the tool result arrives, but it
    // happened before the call left; show it right after the tool call.
    const isAllow = e.kind === 'hook' && e.title.startsWith('Verify hook');
    const call = isAllow ? turn.events.findLastIndex((x) => x.kind === 'tool-call') : -1;
    if (call >= 0) turn.events.splice(call + 1, 0, e);
    else turn.events.push(e);
  }
  return turns;
}

const short = (v: string | undefined, n = 16) =>
  v && v.length > n ? `${v.slice(0, n)}…` : (v ?? '');

// RFC 9421: sig1=("@method" "@authority" ...);keyid="...";alg="...";created=...
function parseSignatureInput(value: string) {
  const m = /^\w+=\(([^)]*)\)(.*)$/.exec(value);
  if (!m) return null;
  return {
    covered: [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
    params: Object.fromEntries(
      [...m[2].matchAll(/;(\w+)=("?)([^;"]*)\2/g)].map((x) => [x[1], x[3]]),
    ),
  };
}

function Sidebar({
  alice,
  bob,
  turns,
}: {
  alice: Identity | null;
  bob: Identity | null;
  turns: Turn[];
}) {
  const all = turns.flatMap((t) => t.events);
  const count = (f: (e: TraceEvent) => boolean) => all.filter(f).length;
  const ledger = [
    ['questions', turns.length],
    [
      'verified',
      count(
        (e) => (e.kind === 'hook' && e.title.includes('ACTIVE')) || e.kind === 'verified',
      ),
    ],
    ['refused', count((e) => e.kind === 'deny' || e.kind === 'rejected')],
    ['signed', count((e) => e.kind === 'request')],
  ] as const;
  return (
    <aside className="sidebar">
      <h1>
        <span className="brand">DNSid</span>
        <br />
        <code>@dnsid-ai/agent-sdk-plugin</code>
      </h1>
      <p className="tagline">
        Agents that prove who they are. Alice verifies Bob before calling him and signs
        what she sends; Bob verifies her back.
      </p>
      <IdentityCard name="Alice" role="asks, verifies, signs" identity={alice} />
      <IdentityCard name="Bob" role="answers, verifies the caller" identity={bob} />
      <section className="ledger">
        {ledger.map(([label, n]) => (
          <div key={label}>
            <b>{n}</b>
            <span>{label}</span>
          </div>
        ))}
      </section>
      <dl className="links">
        <dt>web</dt>
        <dd>
          <a href="https://dnsid.ai">dnsid.ai</a>
        </dd>
        <dt>code</dt>
        <dd>
          <a href="https://github.com/dnsid-ai/agent-sdk-plugin">
            github.com/dnsid-ai/agent-sdk-plugin
          </a>
        </dd>
        <dt>x</dt>
        <dd>
          <a href="https://x.com/dnsidai">@dnsidai</a>
        </dd>
      </dl>
    </aside>
  );
}

function IdentityCard({
  name,
  role,
  identity,
}: {
  name: string;
  role: string;
  identity: Identity | null;
}) {
  const [open, setOpen] = useState(false);
  const record = identity?.record;
  return (
    <section className={`identity ${identity ? (record ? 'ok' : 'bad') : 'off'}`}>
      <header>
        <b>{name}</b>
        <small>{role}</small>
      </header>
      {!identity && <div className="muted">not running</div>}
      {identity && (
        <>
          <div className="domain">{identity.domain}</div>
          <button className="link" onClick={() => setOpen(!open)}>
            {record ? '● _dnsid record in DNS' : '○ no _dnsid record'} {open ? '▴' : '▾'}
          </button>
          {open && record && (
            <dl>
              {identity.kid && (
                <>
                  <dt>key</dt>
                  <dd title={identity.kid}>{short(identity.kid, 22)}</dd>
                </>
              )}
              {['ku', 'su', 'ek', 'lr'].map((k) =>
                record[k] ? (
                  <>
                    <dt key={`${k}t`}>{k}</dt>
                    <dd key={`${k}d`} title={record[k]}>
                      {short(record[k], 40)}
                    </dd>
                  </>
                ) : null,
              )}
            </dl>
          )}
        </>
      )}
    </section>
  );
}

function Steps({ failedAt }: { failedAt?: number }) {
  return (
    <ol className="steps">
      {STEPS.map((s, i) => {
        const state =
          failedAt === undefined
            ? 'pass'
            : i < failedAt
              ? 'pass'
              : i === failedAt
                ? 'fail'
                : 'skip';
        return (
          <li key={s} className={state} style={{ animationDelay: `${i * 160}ms` }}>
            <i>{state === 'pass' ? '✓' : state === 'fail' ? '✕' : '·'}</i>
            {s}
          </li>
        );
      })}
    </ol>
  );
}

function VerdictCard({ e }: { e: TraceEvent }) {
  const d = (e.data ?? {}) as {
    domain?: string;
    state?: string;
    expiresAt?: string;
    code?: string;
    message?: string;
    cannotVerify?: boolean;
  };
  const host =
    d.domain ??
    /denied (\S+):|hook: (\S+) is/.exec(e.title)?.slice(1).find(Boolean) ??
    /DNSid: (\S+?):/.exec(e.title)?.[1];
  if (e.kind === 'deny') {
    const code = d.code ?? /: (\w+):/.exec(e.title)?.[1] ?? '';
    return (
      <article className="card verdict bad">
        <span className="kicker">Verify peer · before the call</span>
        <header>
          <b>Alice verifies {host}</b>
          <span className="pill bad">{d.cannotVerify ? 'cannot verify' : 'refused'}</span>
        </header>
        <Steps failedAt={FAILING_STEP[code] ?? 0} />
        <p className="reason">
          <code>{code}</code> {d.message ?? e.title.split(': ').slice(-1)[0]}
        </p>
        <footer>The request never left. The plugin denies before the tool runs.</footer>
      </article>
    );
  }
  return (
    <article className="card verdict ok">
      <span className="kicker">Verify peer · before the call</span>
      <header>
        <b>Alice verifies {host}</b>
        <span className="pill ok">{d.state ?? 'ACTIVE'}</span>
      </header>
      <Steps />
      {d.expiresAt && (
        <footer title={`until ${new Date(d.expiresAt).toLocaleTimeString()}`}>
          Verdict cached for{' '}
          {Math.max(1, Math.round((Date.parse(d.expiresAt) - e.at) / 60_000))} min.
        </footer>
      )}
      {!d.expiresAt && <footer>All four checks passed; the call may proceed.</footer>}
    </article>
  );
}

function RequestCard({ e }: { e: TraceEvent }) {
  const [open, setOpen] = useState(false);
  const d = e.data as {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  const parsed = d.headers['signature-input']
    ? parseSignatureInput(d.headers['signature-input'])
    : null;
  const signed = ['content-digest', 'signature', 'signature-input'];
  return (
    <article className="card request">
      <span className="kicker">Sign request · RFC 9421</span>
      <header>
        <b>
          On the wire <span className="arrow">→</span> Bob receives
        </b>
        <code>
          {d.method} {new URL(d.url).pathname}
        </code>
      </header>
      {parsed ? (
        <>
          <p>
            Signed by <code>{parsed.params.keyid?.split('#')[0]}</code> with key{' '}
            <code>{short(parsed.params.keyid?.split('#')[1], 12)}</code>,{' '}
            {parsed.params.alg}. The signature covers:
          </p>
          <ul className="covered">
            {parsed.covered.map((c, i) => (
              <li key={c} style={{ animationDelay: `${i * 90}ms` }}>
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">No signature on this request.</p>
      )}
      {d.body && <pre className="body">{d.body}</pre>}
      <button className="link" onClick={() => setOpen(!open)}>
        {open ? 'hide headers ▴' : 'show headers ▾'}
      </button>
      {open && (
        <div className="headers">
          {Object.entries(d.headers)
            .filter(
              ([k]) =>
                ![
                  'host',
                  'connection',
                  'accept-encoding',
                  'user-agent',
                  'content-length',
                  'transfer-encoding',
                ].includes(k) && !k.startsWith('x-'),
            )
            .map(([k, v]) => (
              <div key={k} className={signed.includes(k) ? 'sig' : ''}>
                <b>{k}</b>: {v}
              </div>
            ))}
        </div>
      )}
    </article>
  );
}

function PeerCard({ e }: { e: TraceEvent }) {
  const ok = e.kind === 'verified';
  const d = (e.data ?? {}) as { sender?: string; code?: string; message?: string };
  return (
    <article className={`card peer ${ok ? 'ok' : 'bad'}`}>
      <span className="kicker">Be verifiable · Bob's side</span>
      <header>
        <b>Bob verifies the caller</b>
        <span className={`pill ${ok ? 'ok' : 'bad'}`}>
          {ok ? 'verified' : 'rejected'}
        </span>
      </header>
      {ok ? (
        <p>
          From <code>keyid</code> Bob found <code>{d.sender}</code>, fetched her key, and
          checked the signature. He knows who is asking.
        </p>
      ) : (
        <p className="reason">
          <code>{d.code}</code> {d.message}
        </p>
      )}
    </article>
  );
}

function ResponseCard({ e }: { e: TraceEvent }) {
  const d = e.data as {
    status?: number;
    body?: string;
    headers?: Record<string, string>;
  };
  let body = d.body ?? '';
  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    /* plain text */
  }
  return (
    <article className="card response">
      <span className="kicker">Response</span>
      <header>
        <b>
          Bob answers <span className="arrow">→</span> Alice
        </b>
        <span className={`pill ${(d.status ?? 500) < 400 ? 'ok' : 'bad'}`}>
          HTTP {d.status}
        </span>
      </header>
      <pre className="body">{body.trim()}</pre>
    </article>
  );
}

// Fenced blocks become <pre>, `spans` become <code>. Enough for a short reply.
function Inline({ text }: { text: string }) {
  return (
    <>{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>
  );
}

function Reply({ text }: { text: string }) {
  const parts = text.split(/```\w*\n?/);
  return (
    <div className="reply">
      <span className="avatar">A</span>
      <div>
        {parts.map((p, i) =>
          i % 2 ? (
            <pre key={i}>{p.trim()}</pre>
          ) : p.trim() ? (
            <p key={i}>
              <Inline text={p.trim()} />
            </p>
          ) : null,
        )}
      </div>
    </div>
  );
}

// Shown while either server is unreachable: DNSid Local is not set up, or
// `npm run dev` is not running.
function Setup({ alice, bob }: { alice: Identity | null; bob: Identity | null }) {
  const down =
    !alice && !bob ? 'Alice and Bob are down' : !alice ? 'Alice is down' : 'Bob is down';
  return (
    <div className="setup card">
      <header>
        <b>First boot</b>
        <span className="pill bad">{down}</span>
      </header>
      <p>
        DNSid Local needs three agents, one of them never issued. Once, in a terminal:
      </p>
      <pre className="body">{`dnsid local up
dnsid local agent add alice --upstream http://localhost:3001
dnsid local agent add bob   --upstream http://localhost:3002
dnsid local agent add carol --upstream http://localhost:3004
dnsid local run bob --port 3002 -- dnsid log issue --domain bob.dev.dnsid.test`}</pre>
      <p>
        Then <code>npm run dev</code> here; this page reconnects on its own. To start
        over: <code>dnsid local reset --hard</code>, then the commands above.
      </p>
    </div>
  );
}

function OnlineLine({ e }: { e: TraceEvent }) {
  const text = e.title.replace(/^DNSid: this agent is \S+\.\s*/, '');
  const online = /READY|accepted/.test(text);
  return (
    <div className={`online ${online ? 'ok' : 'bad'}`}>
      <span className="kicker">Bring online · session start</span>
      {text}
    </div>
  );
}

// The harness runs the SessionStart hook on a resume too, so the same
// bring-online line arrives every turn. Show it when it says something new.
const onlineLine = (t: Turn) =>
  t.events.find((e) => e.kind === 'hook' && e.title.startsWith('DNSid: this agent is'))
    ?.title;

function TurnView({ turn, previous }: { turn: Turn; previous?: Turn }) {
  const cards = turn.events.map((e, i) => {
    const key = `${e.at}-${i}`;
    if (e.kind === 'hook' && e.title.startsWith('DNSid: this agent is')) {
      return previous && onlineLine(previous) === e.title ? null : (
        <OnlineLine key={key} e={e} />
      );
    }
    if (e.kind === 'deny' || (e.kind === 'hook' && /Verify hook|Verdict/.test(e.title)))
      return <VerdictCard key={key} e={e} />;
    if (e.kind === 'request') return <RequestCard key={key} e={e} />;
    if (e.kind === 'verified' || e.kind === 'rejected')
      return <PeerCard key={key} e={e} />;
    if (e.kind === 'tool-result' && (e.data as { status?: number })?.status !== undefined)
      return <ResponseCard key={key} e={e} />;
    if (e.kind === 'text') return <Reply key={key} text={e.title} />;
    if (e.kind === 'error')
      return (
        <p key={key} className="error">
          {e.title}
        </p>
      );
    return null;
  });
  const done = turn.events.find((e) => e.kind === 'done')?.data as
    { duration_ms?: number } | undefined;
  return (
    <section className="turn">
      <div className="you" title={turn.prompt.title}>
        {PROMPTS.find(([, prompt]) => prompt === turn.prompt.title)?.[0] ??
          turn.prompt.title}
      </div>
      {cards}
      {!turn.done && (
        <div className="thinking">
          <span />
          <span />
          <span />
        </div>
      )}
      {done?.duration_ms && (
        <div className="took">{(done.duration_ms / 1000).toFixed(1)}s</div>
      )}
    </section>
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
  const turns = useMemo(() => turnsOf(events), [events]);
  const busy = turns.at(-1)?.done === false;
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const send = (prompt: string) => {
    setDraft('');
    fetch('/alice/prompt', { method: 'POST', body: JSON.stringify({ prompt }) });
  };

  return (
    <div className="app">
      <Sidebar alice={alice} bob={bob} turns={turns} />
      <main>
        <div className="feed">
          {turns.length === 0 &&
            (alice && bob ? (
              <div className="welcome">
                <p>
                  Alice is an agent with the DNSid plugin. Ask her to talk to Bob and
                  watch every step: who verified whom, what was signed, and what came
                  back.
                </p>
              </div>
            ) : (
              <Setup alice={alice} bob={bob} />
            ))}
          {turns.map((t, i) => (
            <TurnView key={t.prompt.at} turn={t} previous={turns[i - 1]} />
          ))}
          <div ref={end} />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) send(draft.trim());
          }}
        >
          <div className="chips">
            {PROMPTS.map(([label, prompt]) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => send(prompt)}
              >
                {label}
              </button>
            ))}
            <button type="button" className="ghost" onClick={() => setEvents([])}>
              clear
            </button>
          </div>
          <div className="input">
            <input
              placeholder="Ask Alice anything…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !draft.trim()}>
              {busy ? '…' : 'Send'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
