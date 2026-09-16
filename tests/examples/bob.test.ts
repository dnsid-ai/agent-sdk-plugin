import { describe, expect, it } from 'vitest';

import { handler } from '../../examples/bob.ts';
import { AGENT } from '../shared/fixtures/identity.ts';
import { BOB, aliceAndBob } from '../shared/fixtures/alice-and-bob.ts';

describe('bob', () => {
  it('answers GET to anyone, verifies a signed POST, refuses an unsigned one', async () => {
    const { alice, bob } = await aliceAndBob();
    const respond = handler(BOB, bob);

    expect((await respond(new Request(`https://${BOB}/`))).status).toBe(200);

    const signed = await alice.createSignedHttpRequest(
      new Request(`https://${BOB}/`, { method: 'POST', body: '{"hello":"bob"}' }),
    );
    const ok = await respond(signed);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ from: AGENT, received: '{"hello":"bob"}' });

    const refused = await respond(
      new Request(`https://${BOB}/`, { method: 'POST', body: 'x' }),
    );
    expect(refused.status).toBe(401);
    expect(await refused.text()).toContain('SignatureInvalid');
  });
});
