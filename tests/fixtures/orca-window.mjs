import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const model = 'codex/gpt-6.2-astra';
export const at = Date.parse('2026-11-20T03:00:00Z');
export function createOrcaFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path.join(root,'agent-session-domain.db'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT);
    CREATE TABLE journal_chat_state(session_id TEXT PRIMARY KEY,epoch TEXT);
    CREATE TABLE journal_items(session_id TEXT,epoch TEXT,sequence INTEGER,sequence_index INTEGER,root INTEGER,
      hidden INTEGER,kind TEXT,context_window INTEGER,context_clear INTEGER,payload_json TEXT);`);
  const record = (id, agent, native) => {
    const handle = agent === 'claude' ? {provider:agent,sessionId:native} : {agent,nativeId:native};
    db.prepare('INSERT INTO agent_session_records VALUES (?,?)').run(id,JSON.stringify({sessionId:id, provider:agent,
      location:{workspaceId:'work',executionHostId:'local'}, options:{model}, createdAt:at-1000,updatedAt:at,
      lastTurn:{state:'settled'}, providerHandleChain:native?[{linkId:'proof',handle}]:[],lease:{provenHandleLinkId:'proof'}}));
    db.prepare('INSERT INTO journal_chat_state VALUES (?,?)').run(id,'now');
  };
  const add = (id, seq, facts, opts={}) => db.prepare('INSERT INTO journal_items VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id,opts.epoch??'now',seq,0,opts.root??1,opts.hidden??0,'turn',facts?1:0,opts.clear??0,
      JSON.stringify({observedAt:at+seq,body:{contextUsage:facts}}));
  return {root, db, record, add};
}

if (process.argv[2] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f = createOrcaFixture(process.argv[2]);
  f.record('window', 'custom-agent'); f.record('tokens', 'custom-agent');
  f.add('window', 1, {used:{kind:'report', model, usedTokens:371493, windowTokens:512000, percentage:73, autoCompactAtTokens:479000, capturedAt:at}});
  f.add('tokens', 1, {used:{kind:'estimate', capturedAt:at, usage:{inputTokens:36686,cacheCreationInputTokens:0,cacheReadInputTokens:0}}});
  f.db.close();
}
