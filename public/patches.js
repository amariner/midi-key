export const defaults = {
  wave: 'sawtooth', wave2: 'triangle', mix: 0.35, detune: 7, sub: 0.15,
  attack: 0.02, decay: 0.3, sustain: 0.65, release: 0.8,
  cutoff: 3200, resonance: 1.2, filterEnv: 0.4, vibrato: 0,
  reverb: 0.25, delay: 0.12, drive: 0, octave: 0,
};
export const ranges = {
  mix: [0, 1], detune: [0, 35], sub: [0, 1], attack: [0.005, 3],
  decay: [0.02, 3], sustain: [0, 1], release: [0.03, 6],
  cutoff: [80, 18000], resonance: [0.1, 15], filterEnv: [0, 1],
  vibrato: [0, 30], reverb: [0, 0.8], delay: [0, 0.65], drive: [0, 1], octave: [-2, 2],
};
export function normalizePatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('El sonido debe ser un objeto JSON.');
  const params = { ...defaults };
  const values = raw.params ?? raw;
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (typeof values[key] === 'number' && Number.isFinite(values[key])) params[key] = Math.min(max, Math.max(min, values[key]));
  }
  params.octave = Math.round(params.octave);
  for (const key of ['wave', 'wave2']) {
    if (['sine', 'triangle', 'sawtooth', 'square'].includes(values[key])) params[key] = values[key];
  }
  return {
    id: String(raw.id || `sound-${Date.now()}`).slice(0, 100),
    name: String(raw.name || 'Nuevo sonido').slice(0, 64),
    category: String(raw.category || 'Personal').slice(0, 32),
    description: String(raw.description || 'Un sonido hecho a tu medida.').slice(0, 240),
    params,
  };
}

// A deterministic local description interpreter. The Codex chat can author more detailed patches in data/presets.json.
export function soundFromDescription(description, bank) {
  const text = description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const types = [
    ['bass', /bajo|bass|subgrave|808/], ['keys', /piano|tecla|keys|rhodes/],
    ['bell', /campana|bell|cristal|marimba/], ['pluck', /pluck|punteado|cuerda|guitarra/],
    ['lead', /lead|solista|solo|8.bit|videojuego/], ['pad', /pad|ambiente|ambient|atmosfer|espacial|cuerdas/],
  ];
  const type = types.find(([, pattern]) => pattern.test(text))?.[0] || 'pad';
  const base = bank.find(p => p.id === type) || bank[0] || { params: defaults };
  const patch = normalizePatch({ ...base, id: `custom-${Date.now()}`, name: description.trim().slice(0, 42), category: 'Creado por ti', description });
  const p = patch.params;
  if (/calido|oscuro|suave|warm/.test(text)) { p.cutoff *= 0.5; p.resonance = 0.7; p.drive = 0.08; }
  if (/brillante|bright|metalico/.test(text)) { p.cutoff = 9000; p.filterEnv = 0.65; }
  if (/espacial|reverb|etereo|ambient|atmosfer/.test(text)) { p.reverb = 0.65; p.release = Math.max(p.release, 2.5); }
  if (/seco|sin efectos/.test(text)) { p.reverb = 0; p.delay = 0; }
  if (/eco|delay/.test(text) && !/sin efectos/.test(text)) p.delay = 0.4;
  if (/lento|evolutivo/.test(text)) { p.attack = 1.3; p.release = 3; }
  if (/corto|percusi|staccato/.test(text)) { p.attack = 0.005; p.decay = 0.2; p.sustain = 0.08; p.release = 0.15; }
  if (/distorsi|agresivo|sucio/.test(text)) { p.drive = 0.6; p.wave = 'sawtooth'; }
  if (/8.bit|videojuego/.test(text)) { p.wave = 'square'; p.wave2 = 'square'; p.detune = 0; p.reverb = 0.05; }
  return normalizePatch(patch);
}
