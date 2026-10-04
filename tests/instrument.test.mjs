import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { normalizePatch, soundFromDescription, defaults } from '../public/patches.js';
import { MidiRouter, Synth } from '../public/synth.js';

test('Untrusted/imported parameters stay finite, in range, and use known waves', () => {
  const patch = normalizePatch({ name: '<script>test</script>', params: { cutoff: -10, release: 999, mix: Infinity, wave: 'evil', octave: 1.8, sub: '1' } });
  assert.equal(patch.params.cutoff, 80);
  assert.equal(patch.params.release, 6);
  assert.equal(patch.params.mix, defaults.mix);
  assert.equal(patch.params.wave, defaults.wave);
  assert.equal(patch.params.octave, 2);
  assert.equal(patch.params.sub, defaults.sub);
  assert.throws(() => normalizePatch(null));
  assert.throws(() => normalizePatch([]));
});

test('Local descriptions select a real preset and preserve specified dry effects', async () => {
  const bank = JSON.parse(await readFile(new URL('../data/presets.json', import.meta.url), 'utf8')).map(normalizePatch);
  const bass = soundFromDescription('Un bajo profundo y agresivo, sin efectos', bank);
  assert.equal(bass.params.octave, -1);
  assert.equal(bass.params.drive, 0.6);
  assert.equal(bass.params.reverb, 0);
  assert.equal(bass.params.delay, 0);
  const pad = soundFromDescription('Pad cálido y espacial con ataque lento', bank);
  assert.equal(pad.params.attack, 1.3);
  assert.equal(pad.params.cutoff, 900);
  assert.equal(pad.params.reverb, 0.65);
  assert.notEqual(pad.params, bank[0].params);
});

function routerFixture() {
  const calls = [];
  const synth = Object.fromEntries(['noteOn', 'noteOff', 'pitchBend', 'modulate', 'stopChannel', 'panic'].map(name => [name, (...args) => { calls.push([name, ...args]); return true; }]));
  return { calls, router: new MidiRouter(synth) };
}
test('MIDI note-on with zero velocity releases, and sustain is isolated by channel', () => {
  const { router, calls } = routerFixture();
  router.handle([0x90, 60, 100], 'akai');
  router.handle([0xb0, 64, 127], 'akai');
  router.handle([0x90, 60, 0], 'akai');
  assert.equal(calls.length, 1);
  router.handle([0x91, 60, 90], 'akai');
  router.handle([0x81, 60, 0], 'akai');
  assert.deepEqual(calls.at(-1), ['noteOff', 'akai:1:60']);
  router.handle([0xb0, 64, 0], 'akai');
  assert.deepEqual(calls.at(-1), ['noteOff', 'akai:0:60']);
  assert.equal(router.sustained.size, 0);
});
test('Replayed notes under sustain survive pedal release until their own note-off', () => {
  const { router, calls } = routerFixture();
  router.handle([0xb0, 64, 127]);
  router.handle([0x90, 60, 100]); router.handle([0x80, 60, 0]);
  router.handle([0x90, 60, 100]); router.handle([0xb0, 64, 0]);
  assert.equal(calls.filter(c => c[0] === 'noteOff').length, 0);
  router.handle([0x80, 60, 0]);
  assert.equal(calls.filter(c => c[0] === 'noteOff').length, 1);
});
test('Pitch bend is centered and bounded; channel panic and disconnect reset held notes', () => {
  const { router, calls } = routerFixture();
  router.handle([0xe0, 0, 64], 'akai'); assert.deepEqual(calls.at(-1), ['pitchBend', 'akai:0', 0]);
  router.handle([0xe0, 0, 0], 'akai'); assert.deepEqual(calls.at(-1), ['pitchBend', 'akai:0', -1]);
  router.handle([0xb0, 1, 127], 'akai'); assert.deepEqual(calls.at(-1), ['modulate', 'akai:0', 1]);
  router.handle([0xb0, 64, 127], 'akai'); router.handle([0x90, 62, 99], 'akai');
  router.handle([0xb0, 120, 0], 'akai'); assert.deepEqual(calls.at(-1), ['stopChannel', 'akai:0', true]);
  assert.equal(router.held.size, 0); assert.equal(router.pedals.size, 0);
  router.reset(); assert.deepEqual(calls.at(-1), ['panic']);
});

// Fake nodes exercise ownership and scheduling, while browser QA verifies actual audio rendering.
function param() { return { value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelAndHoldAtTime() {} }; }
function node() { return { gain: param(), frequency: param(), detune: param(), Q: param(), delayTime: param(), connect(target) { return target; }, disconnect() {}, start() {}, stop() {} }; }
function audioFixture() {
  const synth = new Synth();
  synth.context = { state: 'running', currentTime: 0, sampleRate: 48000, createOscillator: node, createGain: node, createBiquadFilter: node, createDelay: node, createConvolver: node };
  synth.bus = node(); return synth;
}
test('Voices from independent sources do not release each other; cleanup respects retrigger ownership', () => {
  const synth = audioFixture();
  synth.noteOn('midi:60', 60); const old = synth.voices.get('midi:60');
  synth.noteOn('screen:60', 60);
  synth.noteOn('midi:60', 60); const replacement = synth.voices.get('midi:60');
  old.oscillators[0].onended();
  assert.equal(synth.voices.get('midi:60'), replacement);
  synth.noteOff('screen:60'); assert.equal(synth.voices.size, 1);
  synth.noteOff('midi:60'); assert.equal(synth.voices.size, 0);
});
test('Repeated release tails cannot exceed the 24-voice allocation cap', () => {
  const synth = audioFixture();
  for (let i = 0; i < 80; i++) { synth.noteOn(`note:${i}`, 60); synth.noteOff(`note:${i}`); }
  assert.equal(synth.allVoices.size, 24);
  assert.equal(synth.voices.size, 0);
});

test('Local server persists sound copies, re-reads chat presets, and rejects external writes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'midi-key-test-'));
  await mkdir(path.join(root, 'public')); await mkdir(path.join(root, 'data'));
  for (const file of ['package.json', 'server.mjs', 'public/patches.js', 'public/index.html', 'data/presets.json']) await cp(new URL(`../${file}`, import.meta.url), path.join(root, file));
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } await rm(root, { recursive: true, force: true }); });
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    child.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited before starting: ${code}`)); });
    child.on('error', reject);
  });
  let response = await fetch(`${base}/api/presets`); const initial = await response.json(); assert.equal(initial.length, 6);
  response = await fetch(base); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
  const patch = { id: 'test-patch', name: 'Test', params: { cutoff: 900 } };
  const headers = { 'Content-Type': 'application/json' };
  response = await fetch(`${base}/api/presets`, { method: 'POST', headers: { ...headers, Origin: 'https://external.example' }, body: JSON.stringify(patch) }); assert.equal(response.status, 403);
  response = await fetch(`${base}/api/presets`, { method: 'POST', headers, body: 'invalid' }); assert.equal(response.status, 400);
  response = await fetch(`${base}/api/presets`, { method: 'POST', headers, body: JSON.stringify(patch) }); assert.equal(response.status, 200);
  response = await fetch(`${base}/api/presets`); assert.equal((await response.json()).length, 7);
  const saved = JSON.parse(await readFile(path.join(root, 'data/user-presets.json'), 'utf8')); assert.equal(saved[0].params.cutoff, 900);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(root, 'data/presets.json'), JSON.stringify([...initial, { id: 'chat-patch', name: 'From chat', params: {} }]));
  response = await fetch(`${base}/api/presets`); assert.equal((await response.json()).length, 8);
  response = await fetch(`${base}/%2e%2e%2fserver.mjs`); assert.equal(response.status, 403);
});
