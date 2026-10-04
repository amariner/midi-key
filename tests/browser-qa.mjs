// Optional browser QA: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-qa.mjs
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = await mkdtemp(path.join(tmpdir(), 'midi-key-browser-'));
for (const file of ['package.json', 'server.mjs', 'public', 'data']) await cp(new URL(`../${file}`, import.meta.url), path.join(root, file), { recursive: true });
const server = spawn(process.execPath, [path.join(root, 'server.mjs')], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    server.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/localhost:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); });
  });
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1130 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.testMidi = { inputs: new Map(), onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => window.testMidi });
  });
  await page.goto(base);
  await page.waitForSelector('.preset-card');
  assert.equal(await page.locator('.preset-card').count(), 6);
  assert.equal(await page.locator('.key').count(), 25);
  await page.screenshot({ path: '/tmp/midi-key-preview.png', fullPage: true });
  await page.click('#audioButton');
  await page.waitForFunction(() => document.querySelector('#audioState').textContent === 'AUDIO ACTIVO');
  // Computer notes continue working when the audio button has keyboard focus.
  await page.keyboard.down('a');
  await page.waitForFunction(() => document.querySelector('#voiceCount').textContent.startsWith('1 /'));
  assert.equal(await page.locator('.key.pressed').count(), 1);
  await page.keyboard.up('a');
  await page.waitForFunction(() => document.querySelector('#voiceCount').textContent.startsWith('0 /'));
  const cKey = page.locator('.key[data-note="60"]');
  await cKey.scrollIntoViewIfNeeded();
  const bounds = await cKey.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 15);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('#voiceCount').textContent.startsWith('1 /'));
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#voiceCount').textContent.startsWith('0 /'));
  await page.click('#midiButton');
  assert.equal(await page.locator('#midiStatus').textContent(), 'Esperando tu teclado');
  await page.evaluate(() => {
    window.testMidi.inputs.set('test-akai', { id: 'test-akai', name: 'Akai MPK test', state: 'connected', onmidimessage: null });
    window.testMidi.onstatechange();
    window.testMidi.inputs.get('test-akai').onmidimessage({ data: [0x90, 60, 100] });
  });
  assert.equal(await page.locator('#midiStatus').textContent(), 'Akai MPK test');
  assert.match(await page.locator('#voiceCount').textContent(), /^1 /);
  await page.evaluate(() => {
    const port = window.testMidi.inputs.get('test-akai');
    port.onmidimessage({ data: [0xb0, 64, 127] }); port.onmidimessage({ data: [0x90, 60, 0] });
  });
  assert.match(await page.locator('#voiceCount').textContent(), /^1 /);
  await page.evaluate(() => window.testMidi.inputs.get('test-akai').onmidimessage({ data: [0xb0, 64, 0] }));
  assert.match(await page.locator('#voiceCount').textContent(), /^0 /);
  await page.fill('#prompt', 'Un bajo profundo y agresivo, sin efectos');
  await page.click('#createButton');
  await page.waitForFunction(() => document.querySelector('#soundName').textContent.startsWith('Un bajo'));
  assert.equal(await page.locator('.preset-card').count(), 7);
  assert.equal(await page.locator('#reverbOutput').textContent(), '0%');
  await page.reload(); await page.waitForSelector('.preset-card');
  assert.equal(await page.locator('.preset-card').count(), 7);
  assert.match(await page.locator('#soundName').textContent(), /^Un bajo/);
  await page.click('#saveButton'); await page.fill('#saveName', 'Mi bajo'); await page.click('#saveForm [type=submit]');
  await page.waitForFunction(() => document.querySelector('#soundName').textContent === 'Mi bajo');
  const downloadEvent = page.waitForEvent('download'); await page.click('#exportButton');
  assert.equal((await downloadEvent).suggestedFilename(), 'Mi-bajo.json');
  await page.locator('#importFile').setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ name: 'Importado', params: { wave: 'square', cutoff: 900 } })) });
  await page.waitForFunction(() => document.querySelector('#soundName').textContent === 'Importado');
  // A chat-authored bank entry appears without reloading the interface.
  const { readFile, writeFile } = await import('node:fs/promises');
  const bankPath = path.join(root, 'data/presets.json');
  const bank = JSON.parse(await readFile(bankPath, 'utf8'));
  await writeFile(bankPath, JSON.stringify([...bank, { id: 'qa-chat', name: 'Desde el chat', category: 'Pad', params: { attack: 1.2 } }]));
  await page.waitForFunction(() => document.querySelector('#soundName').textContent === 'Desde el chat');
  await page.click('#audioButton');
  // Render real Web Audio into an analyser, then verify that silence removes the signal.
  const audioResult = await page.evaluate(async () => {
    const { Synth } = await import('/synth.js');
    const synth = new Synth();
    synth.setPatch({ params: { wave: 'sine', wave2: 'sine', mix: 0, sub: 0, attack: 0.005, sustain: 1, release: 0.03, reverb: 0, delay: 0 } });
    await synth.start(); synth.noteOn('qa', 69, 110);
    await new Promise(resolve => setTimeout(resolve, 400));
    const data = new Float32Array(synth.analyser.fftSize);
    synth.analyser.getFloatTimeDomainData(data);
    const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    synth.panic(); await new Promise(resolve => setTimeout(resolve, 150));
    synth.analyser.getFloatTimeDomainData(data);
    const silentRms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    await synth.context.close(); return { rms, silentRms };
  });
  assert.ok(audioResult.rms > 0.001, `Expected real audio, got ${audioResult.rms}`);
  assert.ok(audioResult.silentRms < 0.0001, `Expected silence, got ${audioResult.silentRms}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/midi-key-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal page overflow on mobile');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: 'Chrome', result: 'passed', checks: ['desktop/mobile layout', 'computer and pointer notes', 'simulated MIDI connection and sustain', 'creation and persistence', 'named saving', 'JSON export/import', 'chat bank live sync', 'real Web Audio signal and silence', 'no page errors'], audioResult }, null, 2));
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exit = once(server, 'exit'); server.kill(); await exit; }
  await rm(root, { recursive: true, force: true });
}
