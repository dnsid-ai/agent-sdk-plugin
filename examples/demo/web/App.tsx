import { useEffect, useRef, useState } from 'react';

import {
  bobSaid,
  secondsOf,
  stepsOf,
  type BobSaid,
  type Call,
  type Turn,
  type Verdict,
} from './turn.ts';
import { useConversation, useIdentity, type Identity } from './hooks.ts';

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

// The four verification steps, and the step each failure code belongs to.
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

function Sidebar({ alice }: { alice: Identity | null }) {
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

function VerdictCard({
  host,
  v,
  beforeCall,
}: {
  host: string;
  v: Verdict;
  /** True when the verify hook decided before a fetch; false for the verify tool. */
  beforeCall: boolean;
}) {
  if (!v.ok) {
    return (
      <article className="card verdict bad">
        <span className="kicker">Verify peer · before the call</span>
        <header>
          <b>Alice verifies {host}</b>
          <span className="pill bad">{v.cannotVerify ? 'cannot verify' : 'refused'}</span>
        </header>
        <Steps failedAt={FAILING_STEP[v.code ?? ''] ?? 0} />
        <p className="reason">
          <code>{v.code}</code> {v.message}
        </p>
        {beforeCall && (
          <footer>The request never left. The plugin denies before the tool runs.</footer>
        )}
      </article>
    );
  }
  return (
    <article className="card verdict ok">
      <span className="kicker">Verify peer · before the call</span>
      <header>
        <b>Alice verifies {host}</b>
        <span className="pill ok">{v.state ?? 'ACTIVE'}</span>
      </header>
      <Steps />
      <footer>All four checks passed; the call may proceed.</footer>
    </article>
  );
}

function RequestCard({
  request,
  signature,
}: {
  request: NonNullable<Call['request']>;
  /** The Signature-Input header, as Bob received it. */
  signature?: string;
}) {
  const parsed = signature ? parseSignatureInput(signature) : null;
  return (
    <article className="card request">
      <span className="kicker">Sign request · RFC 9421</span>
      <header>
        <b>
          Alice signs <span className="arrow">→</span> Bob receives
        </b>
        <code>
          {request.method} {request.path}
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
        <p className="muted">Bob did not report a signature.</p>
      )}
      {request.body && <pre className="body">{request.body}</pre>}
    </article>
  );
}

function PeerCard({ from, refused }: BobSaid) {
  return (
    <article className={`card peer ${from ? 'ok' : 'bad'}`}>
      <span className="kicker">Be verifiable · Bob's answer</span>
      <header>
        <b>Bob verifies the caller</b>
        <span className={`pill ${from ? 'ok' : 'bad'}`}>
          {from ? 'verified' : 'rejected'}
        </span>
      </header>
      {from ? (
        <p>
          From <code>keyid</code> Bob found <code>{from}</code>, fetched her key, and
          checked the signature. He knows who is asking.
        </p>
      ) : (
        <p className="reason">
          <code>{refused?.code}</code> {refused?.message}
        </p>
      )}
    </article>
  );
}

function ResponseCard({ status, body: raw }: { status: number; body: string }) {
  let body = raw;
  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // Not JSON: show the body as it is.
  }
  return (
    <article className="card response">
      <span className="kicker">Response</span>
      <header>
        <b>
          Bob answers <span className="arrow">→</span> Alice
        </b>
        <span className={`pill ${status < 400 ? 'ok' : 'bad'}`}>HTTP {status}</span>
      </header>
      <pre className="body">{body.trim()}</pre>
    </article>
  );
}

// Just enough Markdown for Alice's short replies: fenced blocks become <pre>,
// `spans` become <code>.
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

// Shown while Alice's server is unreachable: DNSid Local is not set up, or
// `npm run dev` is not running.
function Setup() {
  return (
    <div className="setup card">
      <header>
        <b>First boot</b>
        <span className="pill bad">Alice is down</span>
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

function OnlineLine({ text }: { text: string }) {
  const online = /READY|accepted/.test(text);
  return (
    <div className={`online ${online ? 'ok' : 'bad'}`}>
      <span className="kicker">Bring online · session start</span>
      {text}
    </div>
  );
}

// A tool call's cards, in order: verdict, signed request, Bob's check, response.
function CallCards({ call }: { call: Call }) {
  const bob = bobSaid(call.response);
  return (
    <>
      {call.verdict && (
        <VerdictCard
          host={call.host}
          v={call.verdict}
          beforeCall={call.tool === 'fetch'}
        />
      )}
      {call.request && call.response && (
        <RequestCard request={call.request} signature={bob?.signature} />
      )}
      {bob && <PeerCard {...bob} />}
      {call.response && <ResponseCard {...call.response} />}
    </>
  );
}

// The harness runs the SessionStart hook on a resume too, so the same
// bring-online line arrives every turn. Show it when it says something new.
const onlineText = (t?: Turn) =>
  t && stepsOf(t).flatMap((s) => (s.type === 'online' ? [s.text] : []))[0];

function TurnView({ turn, previous }: { turn: Turn; previous?: Turn }) {
  const repeat = onlineText(previous);
  const seconds = secondsOf(turn);
  return (
    <section className="turn">
      <div className="you" title={turn.prompt}>
        {PROMPTS.find(([, prompt]) => prompt === turn.prompt)?.[0] ?? turn.prompt}
      </div>
      {stepsOf(turn).map((step, i) => {
        switch (step.type) {
          case 'online':
            return step.text === repeat ? null : <OnlineLine key={i} text={step.text} />;
          case 'call':
            return <CallCards key={i} call={step.call} />;
          case 'reply':
            return <Reply key={i} text={step.text} />;
        }
      })}
      {turn.error && <p className="error">{turn.error}</p>}
      {!turn.done && (
        <div className="thinking">
          <span />
          <span />
          <span />
        </div>
      )}
      {seconds && <div className="took">{seconds.toFixed(1)}s</div>}
    </section>
  );
}

export function App() {
  const { turns, busy, send, clear } = useConversation();
  const alice = useIdentity('/alice/identity');
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const submit = (prompt: string) => {
    setDraft('');
    send(prompt);
  };

  return (
    <div className="app">
      <Sidebar alice={alice} />
      <main>
        <div className="feed">
          {turns.length === 0 &&
            (alice ? (
              <div className="welcome">
                <p>
                  Alice is an agent with the DNSid plugin. Ask her to talk to Bob and
                  watch every step: who verified whom, what was signed, and what came
                  back.
                </p>
              </div>
            ) : (
              <Setup />
            ))}
          {turns.map((t, i) => (
            <TurnView key={i} turn={t} previous={turns[i - 1]} />
          ))}
          <div ref={end} />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) submit(draft.trim());
          }}
        >
          <div className="chips">
            {PROMPTS.map(([label, prompt]) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => submit(prompt)}
              >
                {label}
              </button>
            ))}
            <button type="button" className="ghost" onClick={clear}>
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
