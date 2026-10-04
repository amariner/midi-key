import { Synth, MidiRouter } from './synth.js';
import { normalizePatch, soundFromDescription } from './patches.js';

const $ = id => document.getElementById(id);
const factoryIds = ['pad', 'keys', 'bass', 'pluck', 'lead', 'bell'];
let bank = [], selected = null, filter = 'Todos', octave = 4, access = null, selectedPort = null;
let bankVersion = '', polling = false, toastTimeout, audioStarting;
const wanted = new Map(), computerOwners = new Map();
const synth = new Synth(notes => {
  const playing = new Set(notes);
  for (const key of document.querySelectorAll('.key')) {
    const pressed = playing.has(Number(key.dataset.note));
    key.classList.toggle('pressed', pressed);
    key.setAttribute('aria-pressed', String(pressed));
  }
  $('voiceCount').textContent = `${notes.length} / 24 VOCES`;
  $('noteDot').classList.toggle('on', notes.length > 0);
});
const router = new MidiRouter(synth, (note, velocity) => {
  $('lastNote').textContent = `${noteName(note)} · Intensidad ${velocity}`;
  if (!synth.context || synth.context.state !== 'running') toast('Pulsa Activar audio para escuchar tu teclado.');
});
const keyMap = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14 };
const names = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
function noteName(note) { return `${names[note % 12]}${Math.floor(note / 12) - 1}`; }
function toast(message) {
  clearTimeout(toastTimeout);
  $('toast').textContent = message; $('toast').classList.add('show');
  toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 5000);
}
async function enableAudio() {
  if (audioStarting) return audioStarting;
  audioStarting = synth.start().then(() => {
    $('audioButton').textContent = '✓ Audio activado';
    $('audioButton').classList.add('active');
    $('audioDot').classList.add('on');
    $('audioState').textContent = 'AUDIO ACTIVO';
    synth.context.onstatechange = () => {
      const active = synth.context.state === 'running';
      $('audioDot').classList.toggle('on', active);
      $('audioState').textContent = active ? 'AUDIO ACTIVO' : 'AUDIO EN PAUSA';
      $('audioButton').textContent = active ? '✓ Audio activado' : '▶ Reanudar audio';
      $('audioButton').classList.toggle('active', active);
    };
  }).finally(() => { audioStarting = null; });
  return audioStarting;
}
$('audioButton').addEventListener('click', () => enableAudio().catch(error => toast(error.message)));
async function play(owner, note) {
  const token = Symbol(); wanted.set(owner, token);
  try {
    await enableAudio();
    if (wanted.get(owner) !== token) return;
    synth.noteOn(owner, note, 100);
    $('lastNote').textContent = `${noteName(note)} · Intensidad 100`;
  } catch (error) { wanted.delete(owner); toast(error.message); }
}
function release(owner) { wanted.delete(owner); synth.noteOff(owner); }
function panic() { wanted.clear(); computerOwners.clear(); router.reset(); }

const config = [
  ['cutoff', 'Filtro', 80, 18000, 'Hz', 'characterControls', true],
  ['resonance', 'Resonancia', 0.1, 15, '', 'characterControls'],
  ['detune', 'Desafinación', 0, 35, 'ct', 'characterControls'],
  ['mix', 'Mezcla A/B', 0, 1, '%', 'characterControls'],
  ['attack', 'Ataque', 0.005, 3, 's', 'envelopeControls'],
  ['decay', 'Caída', 0.02, 3, 's', 'envelopeControls'],
  ['sustain', 'Sustain', 0, 1, '%', 'envelopeControls'],
  ['release', 'Cola', 0.03, 6, 's', 'envelopeControls'],
  ['reverb', 'Reverb', 0, 0.8, '%', 'effectsControls'],
  ['delay', 'Delay', 0, 0.65, '%', 'effectsControls'],
  ['drive', 'Saturación', 0, 1, '%', 'effectsControls'],
  ['sub', 'Subgrave', 0, 1, '%', 'advancedControls'],
  ['filterEnv', 'Env. filtro', 0, 1, '%', 'advancedControls'],
  ['vibrato', 'Vibrato', 0, 30, 'ct', 'advancedControls'],
  ['octave', 'Transposición', -2, 2, 'oct', 'advancedControls'],
];
function format(value, unit) {
  if (unit === '%') return `${Math.round(value * 100)}%`;
  if (unit === 'Hz') return value >= 1000 ? `${(value / 1000).toFixed(1)}k Hz` : `${Math.round(value)} Hz`;
  if (unit === 's') return value < 0.1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
  return `${Number(value.toFixed(1))}${unit ? ` ${unit}` : ''}`;
}
for (const [id, label, min, max, unit, parent, log] of config) {
  const node = document.createElement('label'); node.className = 'control';
  const top = document.createElement('span'); top.className = 'control-top';
  const text = document.createElement('span'); text.className = 'control-name'; text.textContent = label;
  const output = document.createElement('output'); output.id = `${id}Output`; output.htmlFor = id;
  const input = document.createElement('input'); input.type = 'range'; input.id = id;
  input.min = log ? 0 : min; input.max = log ? 1000 : max; input.step = id === 'octave' ? 1 : 'any';
  top.append(text, output); node.append(top, input); $(parent).append(node);
  input.addEventListener('input', () => {
    if (!selected) return;
    const value = log ? min * Math.pow(max / min, Number(input.value) / 1000) : Number(input.value);
    selected.params[id] = value;
    output.textContent = format(value, unit);
    synth.setPatch(selected);
    $('soundCategory').textContent = `${selected.category.toUpperCase()} / EDITADO`;
  });
}
for (const id of ['wave', 'wave2']) $(id).addEventListener('change', () => {
  if (!selected) return;
  selected.params[id] = $(id).value; synth.setPatch(selected);
  $('soundCategory').textContent = `${selected.category.toUpperCase()} / EDITADO`;
});
function selectPatch(patch) {
  panic();
  selected = normalizePatch(patch); synth.setPatch(selected);
  try { localStorage.setItem('midi-key-selected', selected.id); } catch {}
  $('soundName').textContent = selected.name;
  $('soundCategory').textContent = `${selected.category.toUpperCase()} / ${String(Math.max(0, bank.findIndex(p => p.id === patch.id)) + 1).padStart(2, '0')}`;
  $('soundDescription').textContent = selected.description;
  for (const [id, , min, max, unit, , log] of config) {
    const value = selected.params[id];
    $(id).value = log ? Math.log(value / min) / Math.log(max / min) * 1000 : value;
    $(`${id}Output`).textContent = format(value, unit);
  }
  $('wave').value = selected.params.wave; $('wave2').value = selected.params.wave2;
  renderBank();
}
function renderBank() {
  $('presetCount').textContent = String(bank.length).padStart(2, '0');
  $('presetList').replaceChildren();
  const visible = bank.filter(p => filter === 'Todos' || (filter === 'Personal' ? !factoryIds.includes(p.id) : p.category === filter));
  for (const patch of visible) {
    const button = document.createElement('button');
    const isSelected = selected?.id === patch.id;
    button.className = `preset-card${isSelected ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(isSelected));
    const art = document.createElement('span'); art.className = 'preset-art'; art.setAttribute('aria-hidden', 'true');
    art.textContent = ({ Pad: '≋', Keys: '▥', Bass: '∿', Pluck: '⋮', Lead: 'ϟ', Bell: '✧' })[patch.category] || '✳';
    const info = document.createElement('span'), name = document.createElement('strong'), category = document.createElement('small');
    name.textContent = patch.name; category.textContent = patch.category;
    info.append(name, category); button.append(art, info);
    if (isSelected) { const check = document.createElement('span'); check.className = 'preset-check'; check.textContent = '↗'; button.append(check); }
    button.addEventListener('click', () => selectPatch(patch)); $('presetList').append(button);
  }
  if (!visible.length) { const empty = document.createElement('p'); empty.className = 'empty-library'; empty.textContent = 'Tu próxima idea empieza aquí. Crea un sonido y guárdalo en tu banco.'; $('presetList').append(empty); }
}
for (const button of document.querySelectorAll('.filter')) button.addEventListener('click', () => {
  filter = button.dataset.filter;
  for (const item of document.querySelectorAll('.filter')) item.classList.toggle('active', item === button);
  renderBank();
});
async function refreshBank(initial = false) {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/api/presets', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar el banco. Revisa que el servidor siga abierto.');
    const next = (await response.json()).map(normalizePatch), version = JSON.stringify(next);
    $('syncStatus').textContent = 'Banco conectado a este proyecto';
    if (version === bankVersion) return;
    const added = next.filter(p => !bank.some(old => old.id === p.id));
    const updated = next.find(p => p.id === selected?.id && JSON.stringify(p) !== JSON.stringify(bank.find(old => old.id === p.id)));
    bank = next; bankVersion = version;
    if (initial) {
      let saved; try { saved = localStorage.getItem('midi-key-selected'); } catch {}
      if (bank.length) selectPatch(bank.find(p => p.id === saved) || bank[0]);
    } else if (added.length) {
      setFilterAll(); selectPatch(added.at(-1)); toast('Nuevo sonido añadido al banco. Ya puedes tocarlo.');
    } else if (updated) { selectPatch(updated); toast('El sonido se ha actualizado desde el proyecto.'); }
    else renderBank();
  } catch (error) {
    $('syncStatus').textContent = 'Banco desconectado · reintentando';
    if (initial) { toast(error.message); $('soundDescription').textContent = 'Abre la interfaz desde el servidor local para cargar los sonidos.'; }
  } finally { polling = false; }
}
function setFilterAll() {
  filter = 'Todos';
  for (const item of document.querySelectorAll('.filter')) item.classList.toggle('active', item.dataset.filter === 'Todos');
}
async function savePatch(patch) {
  const response = await fetch('/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (!response.ok) throw new Error('No se pudo guardar. Comprueba que el servidor está abierto.');
  const saved = normalizePatch(await response.json());
  bank = [...bank.filter(p => p.id !== saved.id), saved]; bankVersion = JSON.stringify(bank);
  setFilterAll(); selectPatch(saved);
  return saved;
}
$('createForm').addEventListener('submit', async event => {
  event.preventDefault();
  const description = $('prompt').value.trim();
  if (!description) return;
  $('createButton').disabled = true;
  try { await savePatch(soundFromDescription(description, bank)); toast('Sonido creado y guardado. Pruébalo en tu teclado.'); }
  catch (error) { toast(error.message); }
  finally { $('createButton').disabled = false; }
});
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => { $('prompt').value = button.dataset.prompt; $('prompt').focus(); });
// Named saving uses a native HTML dialog, keeping keyboard events out of the instrument while typing.
const saveDialog = document.createElement('dialog'); saveDialog.id = 'saveDialog';
saveDialog.innerHTML = '<form id="saveForm"><span class="eyebrow">GUÁRDALO EN TU PALETA</span><h2>Un nombre para tu sonido.</h2><label for="saveName">Nombre</label><input class="save-name" id="saveName" maxlength="64" required><button class="primary" type="submit">Guardar sonido</button><button class="dialog-close" type="button" aria-label="Cancelar">×</button></form>';
document.body.append(saveDialog);
saveDialog.querySelector('.dialog-close').addEventListener('click', () => saveDialog.close());
$('saveButton').addEventListener('click', () => {
  if (!selected) return toast('Espera a que se cargue el banco.');
  panic(); $('saveName').value = selected.name; saveDialog.showModal(); $('saveName').select();
});
$('saveForm').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('saveName').value.trim(); if (!name) return;
  const button = $('saveForm').querySelector('[type=submit]'); button.disabled = true;
  try {
    await savePatch({ ...selected, id: `saved-${Date.now()}`, name, category: 'Personal' });
    saveDialog.close(); toast('Sonido guardado en tu banco.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('exportButton').addEventListener('click', () => {
  if (!selected) return;
  download(JSON.stringify(selected, null, 2), `${selected.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60)}.json`, 'application/json');
  toast('Sonido exportado como JSON.');
});
$('importButton').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async () => {
  try {
    const file = $('importFile').files[0]; if (!file) return;
    if (file.size > 32768) throw new Error('El archivo es demasiado grande para un sonido.');
    const raw = JSON.parse(await file.text());
    if (!raw.params || !raw.name || Array.isArray(raw)) throw new Error('Importa un sonido JSON con nombre y parámetros.');
    await savePatch(normalizePatch({ ...raw, id: `import-${Date.now()}` })); toast('Sonido importado.');
  } catch (error) { toast(`No se pudo importar: ${error.message}`); }
  finally { $('importFile').value = ''; }
});

function renderKeyboard() {
  const keyboard = $('keyboard'); keyboard.replaceChildren();
  const start = (octave + 1) * 12, whiteNotes = [];
  for (let offset = 0; offset < 25; offset++) if (![1, 3, 6, 8, 10].includes(offset % 12)) whiteNotes.push(start + offset);
  let whiteIndex = 0;
  for (let offset = 0; offset < 25; offset++) {
    const note = start + offset, black = [1, 3, 6, 8, 10].includes(note % 12);
    const button = document.createElement('button');
    button.className = `key ${black ? 'black' : 'white'}`; button.dataset.note = note;
    button.setAttribute('aria-label', noteName(note)); button.setAttribute('aria-pressed', 'false');
    if (black) {
      button.style.left = `${(whiteIndex - 0.31) / whiteNotes.length * 100}%`;
      button.style.width = `${0.58 / whiteNotes.length * 100}%`;
    } else {
      whiteIndex++;
      const label = document.createElement('span'); label.className = 'key-note'; label.textContent = noteName(note); button.append(label);
    }
    const shortcut = Object.keys(keyMap).find(key => keyMap[key] === offset);
    if (shortcut) { const label = document.createElement('span'); label.className = 'key-shortcut'; label.textContent = shortcut.toUpperCase(); button.append(label); }
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); button.setPointerCapture(event.pointerId);
      play(`pointer:${event.pointerId}`, note);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => release(`pointer:${event.pointerId}`));
    button.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key) && !event.repeat) { event.preventDefault(); play(`accessible:${note}`, note); }
    });
    button.addEventListener('keyup', event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); release(`accessible:${note}`); }
    });
    button.addEventListener('blur', () => release(`accessible:${note}`));
    keyboard.append(button);
  }
  $('octaveValue').textContent = octave;
  $('octaveDown').disabled = octave <= 1; $('octaveUp').disabled = octave >= 6;
  synth.notify();
}
function shiftOctave(delta) { panic(); octave = Math.max(1, Math.min(6, octave + delta)); renderKeyboard(); }
$('octaveDown').addEventListener('click', () => shiftOctave(-1));
$('octaveUp').addEventListener('click', () => shiftOctave(1));
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'escape') { panic(); return; }
  if (event.repeat) return;
  if (key === 'z' || key === 'x') { shiftOctave(key === 'z' ? -1 : 1); return; }
  if (keyMap[key] !== undefined) {
    event.preventDefault();
    const owner = `computer:${key}`; computerOwners.set(event.code, owner);
    play(owner, (octave + 1) * 12 + keyMap[key]);
  }
});
document.addEventListener('keyup', event => {
  const owner = computerOwners.get(event.code);
  if (owner) { release(owner); computerOwners.delete(event.code); }
});
window.addEventListener('blur', panic);
document.addEventListener('visibilitychange', () => { if (document.hidden) panic(); });
$('panicButton').addEventListener('click', () => { panic(); toast('Todas las notas detenidas.'); });
$('volume').addEventListener('input', () => { synth.setVolume(Number($('volume').value) / 100); $('volumeValue').textContent = `${$('volume').value}%`; });

function refreshMidi() {
  const inputs = [...access.inputs.values()].filter(p => p.state === 'connected');
  for (const input of access.inputs.values()) input.onmidimessage = null;
  const previous = selectedPort;
  if (!inputs.some(p => p.id === selectedPort)) selectedPort = (inputs.find(p => /akai|mpk|lpk/i.test(p.name)) || inputs[0])?.id || null;
  if (previous !== selectedPort) router.reset();
  $('midiInput').replaceChildren();
  for (const input of inputs) { const option = document.createElement('option'); option.value = input.id; option.textContent = input.name || 'Teclado MIDI'; $('midiInput').append(option); }
  $('midiInput').value = selectedPort || ''; $('midiInput').hidden = inputs.length < 2;
  const port = inputs.find(p => p.id === selectedPort);
  if (port) {
    port.onmidimessage = event => router.handle(event.data, port.id);
    $('midiStatus').textContent = port.name || 'Teclado conectado';
    $('midiHint').textContent = 'Conectado. Toca una nota para empezar.';
    $('midiButton').textContent = '✓ MIDI conectado'; $('midiDot').classList.add('on');
  } else {
    $('midiStatus').textContent = 'Esperando tu teclado';
    $('midiHint').textContent = 'Conecta el Akai por USB. Lo detectaremos automáticamente.';
    $('midiButton').textContent = '↔ Buscar teclado'; $('midiDot').classList.remove('on');
    router.reset();
  }
}
$('midiButton').addEventListener('click', async () => {
  if (!navigator.requestMIDIAccess) {
    $('midiStatus').textContent = 'Abre esta página en Google Chrome';
    $('midiHint').textContent = 'Este navegador no ofrece acceso MIDI. El teclado en pantalla sí funciona.';
    toast('Usa Google Chrome para conectar tu Akai por MIDI.'); return;
  }
  $('midiButton').disabled = true;
  try {
    await enableAudio();
    access ||= await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = refreshMidi; refreshMidi();
  } catch (error) {
    $('midiStatus').textContent = 'No se pudo conectar MIDI';
    $('midiHint').textContent = error.name === 'NotAllowedError' ? 'Permite el acceso MIDI en los permisos de Chrome y vuelve a intentarlo.' : 'Comprueba el cable USB y vuelve a intentarlo.';
    toast($('midiHint').textContent);
  } finally { $('midiButton').disabled = false; }
});
$('midiInput').addEventListener('change', () => { router.reset(); selectedPort = $('midiInput').value; refreshMidi(); });
$('helpButton').addEventListener('click', () => { panic(); $('helpDialog').showModal(); });
$('closeHelp').addEventListener('click', () => $('helpDialog').close());

const canvas = $('scope'), pen = canvas.getContext('2d'), samples = new Uint8Array(2048);
let frame = 0;
function drawScope() {
  requestAnimationFrame(drawScope);
  if (document.hidden || ++frame % 2) return;
  const rect = canvas.getBoundingClientRect(), scale = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(rect.width * scale) || canvas.height !== Math.round(rect.height * scale)) { canvas.width = rect.width * scale; canvas.height = rect.height * scale; }
  const w = canvas.width, h = canvas.height;
  pen.clearRect(0, 0, w, h);
  pen.strokeStyle = '#253026'; pen.lineWidth = scale * 0.5;
  for (let x = 0; x < w; x += 32 * scale) { pen.beginPath(); pen.moveTo(x, 0); pen.lineTo(x, h); pen.stroke(); }
  for (let y = 0; y < h; y += 26 * scale) { pen.beginPath(); pen.moveTo(0, y); pen.lineTo(w, y); pen.stroke(); }
  if (synth.analyser) synth.analyser.getByteTimeDomainData(samples); else samples.fill(128);
  pen.strokeStyle = '#b0c19b'; pen.lineWidth = 1.4 * scale; pen.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = i / (samples.length - 1) * w, y = h / 2 + (samples[i] - 128) / 128 * h * 0.44;
    if (i === 0) pen.moveTo(x, y); else pen.lineTo(x, y);
  }
  pen.stroke();
}
renderKeyboard(); drawScope();
await refreshBank(true);
setInterval(() => { if (!document.hidden) refreshBank(); }, 2000);
