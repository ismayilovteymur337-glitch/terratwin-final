import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { shareMeridianAnthropicKey } from '../server/env.ts';
import { llmRouter } from '../server/llm-router.ts';

const FAKE_KEY = 'sk-ant-api03-TEST-NOT-A-REAL-KEY-123456';

test('router offers Claude 5.5 models and no longer Gemini 2.5 or Claude 3.7', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
  try {
    const ids = llmRouter.discoverModels().map((m) => m.id);
    assert.ok(ids.includes('claude-sonnet-5-5'));
    assert.ok(ids.includes('claude-opus-5-5'));
    assert.ok(ids.includes('claude-haiku-5-5'));
    assert.ok(!ids.some((id) => id.startsWith('gemini')));
    assert.ok(!ids.includes('claude-3-7-sonnet-latest'));
    const first = llmRouter.selectCandidates('mission_reasoning')[0];
    assert.equal(first.id, 'claude-sonnet-5-5', 'Sonnet 5.5 is the default choice');
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test('timeout setting allows long answers (default 60 s, up to 180 s)', () => {
  assert.equal(llmRouter.getConfig().timeoutMs, 60000);
  assert.equal(llmRouter.updateConfig({ timeoutMs: 999999 }).timeoutMs, 180000);
  llmRouter.updateConfig({ timeoutMs: 60000 });
});

test('TerraTwin reuses the key saved by Meridian in earth/backend/.env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-env-'));
  fs.mkdirSync(path.join(root, 'earth', 'backend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'earth', 'backend', '.env'), `AGENT_MODEL=claude-sonnet-5-5\nANTHROPIC_API_KEY="${FAKE_KEY}"\n`);
  const saved = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    shareMeridianAnthropicKey(root);
    assert.equal(process.env.ANTHROPIC_API_KEY, FAKE_KEY);

    // A key set for TerraTwin itself always wins.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-own-key-1234567890';
    shareMeridianAnthropicKey(root);
    assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-ant-own-key-1234567890');

    // Missing file: nothing happens, no crash.
    delete process.env.ANTHROPIC_API_KEY;
    shareMeridianAnthropicKey(path.join(root, 'nowhere', 'deeper'));
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});
