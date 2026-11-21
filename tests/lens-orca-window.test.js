import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { orcaChatActive } from '../dist/lens/active.js';
import { defaultOrcaRoot, orcaLocalPath, readOrcaSession, terminalNativeKey } from '../dist/lens/orca-session.js';
import { orcaSnapshot } from '../dist/lens/orca-context.js';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { CostHistory } from '../dist/lens/cost-history.js';
import { startServer } from '../dist/lens/server.js';

import { createOrcaFixture, model, at } from './fixtures/orca-window.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'lens-orca-window-'));
  const f = createOrcaFixture(root);
  t.after(() => { f.db.close(); fs.rmSync(root, {recursive:true,force:true}); });
  return f;
}
const report = (now=at) => ({used:{kind:'report',model,usedTokens:371493,windowTokens:512000,percentage:73,
  autoCompactAtTokens:479000,capturedAt:now,categories:[{name:'Messages',tokens:200000},{name:'Skills',tokens:20000,deferred:true}]}});

test('Orca 当前代次按回合、清空边界和主线程选择读数，A/B/A 互不串读', t => {
  const f=fixture(t); f.record('a','claude','native-a'); f.record('b','custom-agent');
  f.db.prepare("UPDATE agent_session_records SET record_json=json_set(record_json,'$.lastTurn.reply',?) WHERE session_id='a'").run('x'.repeat(300000));
  f.add('a',2,report()); f.add('a',3,{used:{kind:'unknown',capturedAt:at+3}},{hidden:1});
  f.add('a',4,{used:{kind:'unknown',capturedAt:at+4}},{root:0});
  f.add('a',8,{used:{kind:'unknown',capturedAt:at+8}},{epoch:'previous'});
  f.add('b',1,{window:{tokens:100000,capturedAt:at}}); f.add('b',2,{used:{kind:'estimate',capturedAt:at,
    usage:{inputTokens:2000,cacheReadInputTokens:20000,cacheCreationInputTokens:10,outputTokens:1000}}});
  const files=new Set(['claude:native-a']);
  const get=id=>readOrcaSession(id,'work',f.root);
  const choices=['a','b','a'].map(id=>orcaChatActive(get(id),files).selected);
  assert.deepEqual(choices,['claude:native-a','orca:b','claude:native-a']);
  assert.equal(get('a').facts.kind,'report'); assert.equal(readOrcaSession('a','other',f.root),undefined);
  const a=orcaSnapshot(get('a'),'model'),b=orcaSnapshot(get('b'),'model');
  assert.deepEqual([a.context.windowPercent,a.context.remainingWindowTokens,a.context.remainingBeforeCompaction],[73,140507,107507]);
  assert.equal(a.context.segments.find(s=>s.id==='skills').tokens,null);
  assert.deepEqual([b.session.agent,b.context.usedTokens,b.context.windowEstimated,b.totals.all.requests,b.cost.amount],
    ['custom-agent',22010,true,null,null]);
  f.add('a',9,null,{clear:1}); assert.equal(orcaSnapshot(get('a'),'model',a).context.usedTokens,null);
  f.add('a',10,{used:{kind:'estimate',capturedAt:at+10,usage:{inputTokens:90,cacheReadInputTokens:10,cacheCreationInputTokens:0}}});
  const reset=orcaSnapshot(get('a'),'model'); assert.equal(reset.context.usedTokens,100); assert.equal(reset.context.windowPercent,null);
  f.add('a',11,{used:{kind:'unknown',capturedAt:at+11}}); assert.equal(orcaSnapshot(get('a'),'model',reset).context.usedTokens,null);
});

test('Orca 路由从本地 HTTP 快照、逐请求明细和历史账本按同一单价计费', async t => {
  const f=fixture(t); f.record('host','claude','local'); f.record('other','other-agent'); f.add('host',1,report());
  const claude=path.join(f.root,'claude');fs.mkdirSync(claude);
  const iso=new Date(at-100).toISOString();
  const usage={input_tokens:400000,cache_read_input_tokens:50000,cache_creation_input_tokens:0,output_tokens:1000};
  const row={type:'assistant',sessionId:'local',cwd:f.root,timestamp:iso,message:{id:'one',model,usage}};
  fs.writeFileSync(path.join(claude,'local.jsonl'),[row,row].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const previous=process.env.CONTEXT_LENS_HOME;process.env.CONTEXT_LENS_HOME=f.root;
  t.after(()=>{if(previous===undefined)delete process.env.CONTEXT_LENS_HOME;else process.env.CONTEXT_LENS_HOME=previous;});
  const collector=new SessionCollector({claude,codex:path.join(f.root,'codex')});
  const costs=new CostHistory({home:f.root,native:()=>collector.list(),sources:[]});await costs.refresh(true);
  const {server,url}=await startServer({port:0,collector,costHistory:costs,orcaRoot:f.root,pricingRefresh:false});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const get=async p=>{const r=await fetch(url+p);assert.equal(r.status,200);return r.json()};
  const p='/api/snapshot?session=claude:local&orcaSession=host&git=0';
  const main=await get(p);
  assert.deepEqual([main.session.model,main.context.windowPercent,main.context.remainingWindowTokens,main.totals.all.requests],[model,73,140507,1]);
  assert.ok(main.cost.amount>0);
  const detail=await get('/api/details?session=claude:local&section=requests');
  assert.equal(detail.items.length,1);assert.equal(detail.items[0].cost.amount,main.cost.amount);
  const history=await get('/api/costs?period=custom&start=2026-11-20&end=2026-11-20&timeZone=UTC');
  assert.equal(history.totals.period.amount,main.cost.amount);
  assert.equal((await fetch(url+'/api/snapshot?session=claude:local&orcaSession=other')).status,404);
  const other=await get('/api/snapshot?session=orca:other');assert.equal(other.session.agent,'other-agent');assert.equal(other.totals.all.requests,null);
  assert.equal(other.session.model,'');assert.equal(other.session.selectedModel,model);
  assert.equal((await get('/api/details?session=orca:other')).supported,false);
  const writePrices=prices=>fs.writeFileSync(path.join(f.root,'config.json'),JSON.stringify({currency:'USD',prices}));
  writePrices({'*':{input:1,output:1,cacheRead:1},[model]:{input:0,output:0,cacheRead:0}});
  assert.equal((await get(p)).cost.amount,0);
  writePrices({'*':{input:1,output:1,cacheRead:1}});
  assert.equal((await get(p)).cost.amount,0.451);
});

test('Windows 仅映射目标 WSL 发行版，终端身份必须唯一归属本机窗格', t => {
  assert.equal(defaultOrcaRoot('win32','C:\\Users\\A','D:\\Data'),'D:\\Data\\orca');
  assert.equal(orcaLocalPath('/home/me/repo','Ubuntu','win32'),'\\\\wsl.localhost\\Ubuntu\\home\\me\\repo');
  assert.equal(orcaLocalPath('\\\\wsl.localhost\\Debian\\home','Ubuntu','win32'),undefined);
  assert.equal(orcaLocalPath('/home/../root','Ubuntu','win32'),undefined);
  const f=fixture(t),dir=path.join(f.root,'agent-hooks');fs.mkdirSync(dir);
  const db=new DatabaseSync(path.join(dir,'agent-identities.db'));
  db.exec('CREATE TABLE provider_links(orca_session_id,execution_host,wsl_distro,agent,provider_session_id)');
  const link=db.prepare('INSERT INTO provider_links VALUES (?,?,?,?,?)');
  link.run('pane','local','','claude','foo');link.run('pane','remote','','claude','foreign');
  assert.equal(terminalNativeKey(f.root,'pane','claude'),'claude:foo');
  link.run('pane','local','','claude','bar');
  assert.equal(terminalNativeKey(f.root,'pane','claude'),null);db.close();
});
