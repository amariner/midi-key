import { normalizePatch } from './patches.js';

export class Synth {
  constructor(onVoices = () => {}) {
    this.onVoices = onVoices;
    this.voices = new Map();
    this.allVoices = new Set();
    this.bends = new Map();
    this.mods = new Map();
    this.volume = 0.55;
    this.patch = normalizePatch({});
    this.nextId = 0;
  }
  async start() {
    if (!this.context) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) throw new Error('Este navegador no dispone de audio web.');
      const ctx = this.context = new Context({ latencyHint: 'interactive' });
      this.bus = ctx.createGain();
      this.shaper = ctx.createWaveShaper();
      this.shaper.oversample = '2x';
      this.master = ctx.createGain();
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -8;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 12;
      this.compressor.attack.value = 0.003;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.bus.connect(this.shaper);
      this.shaper.connect(this.master);
      this.delaySend = ctx.createGain();
      this.delay = ctx.createDelay(1);
      this.delay.delayTime.value = 0.32;
      this.feedback = ctx.createGain();
      this.feedback.gain.value = 0.32;
      this.shaper.connect(this.delaySend).connect(this.delay);
      this.delay.connect(this.feedback).connect(this.delay);
      this.delay.connect(this.master);
      this.reverbSend = ctx.createGain();
      this.reverb = ctx.createConvolver();
      const length = Math.floor(ctx.sampleRate * 2.8);
      const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
      }
      this.reverb.buffer = impulse;
      this.shaper.connect(this.reverbSend).connect(this.reverb).connect(this.master);
      this.master.connect(this.compressor).connect(this.analyser).connect(ctx.destination);
      this.setVolume(this.volume);
      this.setPatch(this.patch);
    }
    await this.context.resume();
  }
  setVolume(value) {
    this.volume = value;
    this.master?.gain.setTargetAtTime(value * 0.6, this.context.currentTime, 0.02);
  }
  setPatch(patch) {
    this.patch = normalizePatch(patch);
    if (!this.context) return;
    const p = this.patch.params, t = this.context.currentTime;
    this.delaySend.gain.setTargetAtTime(p.delay, t, 0.03);
    this.reverbSend.gain.setTargetAtTime(p.reverb, t, 0.03);
    const curve = new Float32Array(2048);
    const amount = 1 + p.drive * 18;
    for (let i = 0; i < curve.length; i++) {
      const x = i * 2 / (curve.length - 1) - 1;
      curve[i] = p.drive ? Math.tanh(x * amount) / Math.tanh(amount) : x;
    }
    this.shaper.curve = curve;
    for (const voice of this.voices.values()) {
      voice.filter.frequency.setTargetAtTime(Math.min(p.cutoff, this.context.sampleRate * 0.45), t, 0.03);
      voice.filter.Q.setTargetAtTime(p.resonance, t, 0.03);
      voice.oscillators[0].type = p.wave;
      voice.oscillators[1].type = p.wave2;
      voice.levels[0].gain.setTargetAtTime(1 - p.mix * 0.6, t, 0.02);
      voice.levels[1].gain.setTargetAtTime(p.mix * 0.7, t, 0.02);
      voice.levels[2].gain.setTargetAtTime(p.sub * 0.7, t, 0.02);
      this.tune(voice);
    }
  }
  tune(voice) {
    const t = this.context.currentTime, p = this.patch.params;
    const bend = (this.bends.get(voice.channel) || 0) * 200;
    voice.oscillators.forEach((osc, i) => {
      const frequency = 440 * Math.pow(2, (voice.note + p.octave * 12 - 69) / 12);
      osc.frequency.setTargetAtTime(frequency * (i === 2 ? 0.5 : 1), t, 0.01);
      osc.detune.setTargetAtTime(bend + (i === 0 ? -p.detune : i === 1 ? p.detune : 0), t, 0.01);
    });
    voice.lfoGain.gain.setTargetAtTime(p.vibrato + (this.mods.get(voice.channel) || 0) * 35, t, 0.02);
  }
  noteOn(owner, note, velocity = 100, channel = 'screen') {
    if (!this.context || this.context.state !== 'running') return false;
    if (this.voices.has(owner)) this.releaseVoice(this.voices.get(owner), true);
    // Include release tails in the voice cap so repeated notes cannot accumulate unlimited nodes.
    if (this.allVoices.size >= 24) this.releaseVoice(this.allVoices.values().next().value, true);
    const ctx = this.context, p = this.patch.params, t = ctx.currentTime;
    const frequency = 440 * Math.pow(2, (note + p.octave * 12 - 69) / 12);
    const amp = ctx.createGain(), filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.resonance;
    const cutoff = Math.min(p.cutoff, ctx.sampleRate * 0.45);
    const peak = Math.min(cutoff * (1 + p.filterEnv * 4), ctx.sampleRate * 0.45);
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.linearRampToValueAtTime(peak, t + p.attack);
    filter.frequency.exponentialRampToValueAtTime(cutoff, t + p.attack + p.decay);
    const gain = 0.16 * Math.pow(Math.max(1, velocity) / 127, 0.7);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + p.attack);
    amp.gain.linearRampToValueAtTime(gain * p.sustain, t + p.attack + p.decay);
    filter.connect(amp).connect(this.bus);
    const oscillators = [], levels = [];
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator(), level = ctx.createGain();
      osc.type = i === 0 ? p.wave : i === 1 ? p.wave2 : 'sine';
      osc.frequency.value = frequency * (i === 2 ? 0.5 : 1);
      level.gain.value = i === 0 ? 1 - p.mix * 0.6 : i === 1 ? p.mix * 0.7 : p.sub * 0.7;
      osc.connect(level).connect(filter);
      oscillators.push(osc); levels.push(level);
    }
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 5.2;
    lfo.connect(lfoGain);
    for (const osc of oscillators) lfoGain.connect(osc.detune);
    const voice = { id: ++this.nextId, owner, note, channel, amp, filter, oscillators, levels, lfo, lfoGain, released: false };
    this.voices.set(owner, voice);
    this.allVoices.add(voice);
    this.tune(voice);
    for (const osc of oscillators) osc.start(t);
    lfo.start(t);
    oscillators[0].onended = () => this.cleanup(voice);
    this.notify();
    return true;
  }
  noteOff(owner) {
    const voice = this.voices.get(owner);
    if (voice) this.releaseVoice(voice);
  }
  releaseVoice(voice, immediate = false) {
    if (!voice || (voice.released && !immediate)) return;
    const t = this.context.currentTime;
    voice.released = true;
    if (this.voices.get(voice.owner) === voice) this.voices.delete(voice.owner);
    const release = immediate ? 0.012 : this.patch.params.release;
    voice.amp.gain.cancelAndHoldAtTime(t);
    voice.amp.gain.linearRampToValueAtTime(0, t + release);
    for (const osc of [...voice.oscillators, voice.lfo]) { try { osc.stop(t + release + 0.01); } catch {} }
    if (immediate) this.allVoices.delete(voice);
    this.notify();
  }
  cleanup(voice) {
    for (const node of [...voice.oscillators, ...voice.levels, voice.lfo, voice.lfoGain, voice.amp, voice.filter]) node.disconnect();
    this.allVoices.delete(voice);
  }
  pitchBend(channel, amount) {
    this.bends.set(channel, amount);
    for (const v of this.voices.values()) if (v.channel === channel) this.tune(v);
  }
  modulate(channel, amount) {
    this.mods.set(channel, amount);
    for (const v of this.voices.values()) if (v.channel === channel) this.tune(v);
  }
  stopChannel(channel, immediate = false) {
    for (const v of this.allVoices) if (v.channel === channel) this.releaseVoice(v, immediate);
  }
  panic() {
    for (const v of this.allVoices) this.releaseVoice(v, true);
    this.bends.clear(); this.mods.clear();
    // Flush delay and reverb tails while preserving the current effect settings.
    if (this.context) {
      this.delaySend.disconnect(); this.delay.disconnect(); this.feedback.disconnect();
      this.delay = this.context.createDelay(1); this.delay.delayTime.value = 0.32;
      this.feedback = this.context.createGain(); this.feedback.gain.value = 0.32;
      this.delaySend.connect(this.delay);
      this.delay.connect(this.feedback).connect(this.delay); this.delay.connect(this.master);
      const impulse = this.reverb.buffer;
      this.reverbSend.disconnect(); this.reverb.disconnect();
      this.reverb = this.context.createConvolver(); this.reverb.buffer = impulse;
      this.reverbSend.connect(this.reverb).connect(this.master);
    }
    this.notify();
  }
  notify() { this.onVoices([...this.voices.values()].map(v => v.note)); }
}

export class MidiRouter {
  constructor(synth, onActivity = () => {}) {
    this.synth = synth;
    this.onActivity = onActivity;
    this.held = new Map();
    this.sustained = new Map();
    this.pedals = new Set();
  }
  handle(data, port = 'midi') {
    const [status, note, value = 0] = data;
    const command = status & 0xf0, channel = `${port}:${status & 0x0f}`, owner = `${channel}:${note}`;
    if (command === 0x90 && value > 0) {
      this.sustained.delete(owner);
      if (this.synth.noteOn(owner, note, value, channel)) this.held.set(owner, channel);
      this.onActivity(note, value);
    } else if (command === 0x80 || (command === 0x90 && value === 0)) {
      this.held.delete(owner);
      if (this.pedals.has(channel)) this.sustained.set(owner, channel);
      else this.synth.noteOff(owner);
    } else if (command === 0xe0) {
      this.synth.pitchBend(channel, Math.max(-1, Math.min(1, ((value << 7) + note - 8192) / 8192)));
    } else if (command === 0xb0) {
      if (note === 64) {
        if (value >= 64) this.pedals.add(channel);
        else {
          this.pedals.delete(channel);
          for (const [key, ch] of this.sustained) if (ch === channel) { this.synth.noteOff(key); this.sustained.delete(key); }
        }
      }
      if (note === 1) this.synth.modulate(channel, value / 127);
      if (note === 120 || note === 123) {
        this.synth.stopChannel(channel, note === 120);
        this.clearChannel(channel);
      }
    }
  }
  clearChannel(channel) {
    this.pedals.delete(channel);
    for (const map of [this.held, this.sustained]) for (const [key, ch] of map) if (ch === channel) map.delete(key);
  }
  reset() { this.held.clear(); this.sustained.clear(); this.pedals.clear(); this.synth.panic(); }
}
