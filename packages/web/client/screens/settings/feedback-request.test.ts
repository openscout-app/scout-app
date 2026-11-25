import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("feedback stays on the serving origin when another mesh host is focused", async () => {
  const code = `
    import assert from 'node:assert/strict';
    import { hostFleet } from '../../lib/hosts/host-fleet.ts';
    import { feedbackRequest } from './feedback-request.ts';
    let remoteCalls=0; const requests=[];
    hostFleet.add({id:'remote',label:'Remote',fetch:async()=>{remoteCalls++;throw Error('raw note must not leave via mesh');},eventSource:()=>{throw Error('unused');}});
    hostFleet.focus('remote');
    globalThis.fetch=async(path,init)=>{requests.push({path,init});return Response.json({ok:true});};
    await feedbackRequest('preview',{note:'private draft'});
    hostFleet.focus('local');await feedbackRequest('send',{token:'approved-draft'});
    assert.equal(remoteCalls,0);assert.deepEqual(requests.map(r=>r.path),['/api/feedback/preview','/api/feedback/send']);
    assert.ok(requests.every(r=>r.init.credentials==='same-origin'));
    assert.deepEqual(JSON.parse(requests[1].init.body),{token:'approved-draft'});
  `;
  const child = Bun.spawn([process.execPath, "-e", code], { cwd: fileURLToPath(new URL(".", import.meta.url)), stdout: "pipe", stderr: "pipe" });
  const [status, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(errors).toBe(""); expect(status).toBe(0);
});
