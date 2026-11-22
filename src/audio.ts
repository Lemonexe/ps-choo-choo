import type { SoundPlan, SoundPreferences } from "./sound-model.js";

type Layer = { gain: GainNode; filter: BiquadFilterNode };

/** Lazy, self-contained procedural audio. Audio time is never fed into physics. */
export class LocomotiveAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private simulation: GainNode | undefined;
  private whistleBus: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private railImpact: AudioBuffer | undefined;
  private layers: Record<string, Layer> = {};
  private screechGain: GainNode | undefined;
  private screechTones: { tone: OscillatorNode; ratio: number }[] = [];
  private whistleTones: GainNode[] = [];
  private plan: SoundPlan | undefined;
  private nextBeat = 0;
  private nextClack = 0;
  private beat = 0;
  private beatHz = 0;
  private clackHz = 0;
  private timer: number | undefined;
  private opening = false;
  private failed = false;

  constructor(private status: (message: string, retry: boolean) => void) {}

  async unlock(preferences: SoundPreferences): Promise<void> {
    if (!preferences.enabled || preferences.volume === 0 || this.opening) return;
    if (this.context?.state === "running" && !this.failed) return;
    this.opening = true;
    try {
      if (!this.context || this.context.state === "closed") this.create();
      await this.context!.resume();
      if (this.context!.state !== "running")
        throw new Error("Audio is waiting for a user gesture.");
      this.failed = false;
      this.status("", false);
      this.apply();
    } catch {
      this.failed = true;
      this.silence();
      this.status("Sound could not start. You can retry; the simulation is unaffected.", true);
    } finally {
      this.opening = false;
    }
  }

  update(plan: SoundPlan): void {
    this.plan = plan;
    this.apply();
  }

  private ramp(node: GainNode | undefined, value: number): void {
    if (!node || !this.context) return;
    const now = this.context.currentTime;
    node.gain.cancelAndHoldAtTime(now);
    node.gain.setTargetAtTime(value, now, 0.012);
  }

  private create(): void {
    const context = new AudioContext();
    this.context = context;
    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    // A heavy steel clunk: brief low impact, inharmonic ringing, tight reflections.
    // Synthesize once, then play at its original sample rate at every speed.
    this.railImpact = context.createBuffer(
      2,
      Math.ceil(context.sampleRate * 0.65),
      context.sampleRate,
    );
    const dry = new Float32Array(this.railImpact.length);
    let lowNoise = 0;
    for (let i = 0; i < dry.length; i++) {
      const t = i / context.sampleRate;
      const noise = Math.random() * 2 - 1;
      lowNoise += 0.12 * (noise - lowNoise);
      // Keep the bass in the initial impact; sustained low sine modes sound like a drum.
      const impact =
        0.58 * Math.sin(2 * Math.PI * 63 * t) * Math.exp(-t / 0.025) +
        0.19 * Math.sin(2 * Math.PI * 101 * t) * Math.exp(-t / 0.018);
      const ring =
        0.19 * Math.sin(2 * Math.PI * 147 * t) * Math.exp(-t / 0.22) +
        0.12 * Math.sin(2 * Math.PI * 263 * t) * Math.exp(-t / 0.19) +
        0.08 * Math.sin(2 * Math.PI * 431 * t) * Math.exp(-t / 0.155) +
        0.045 * Math.sin(2 * Math.PI * 719 * t) * Math.exp(-t / 0.1) +
        0.025 * Math.sin(2 * Math.PI * 1087 * t) * Math.exp(-t / 0.07);
      dry[i] =
        (1 - Math.exp(-t / 0.001)) *
        (impact + ring + (noise - lowNoise) * 0.2 * Math.exp(-t / 0.007));
    }
    for (let channel = 0; channel < 2; channel++) {
      const data = this.railImpact.getChannelData(channel);
      const delays = channel === 0 ? [0.011, 0.023, 0.047] : [0.013, 0.029, 0.053];
      for (let i = 0; i < data.length; i++) {
        data[i] = dry[i]! * 0.8;
        for (let tap = 0; tap < delays.length; tap++) {
          const sample = i - Math.round(delays[tap]! * context.sampleRate);
          if (sample >= 0) data[i] = data[i]! + dry[sample]! * [0.14, 0.08, 0.04][tap]!;
        }
      }
    }
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    compressor.connect(context.destination);
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(compressor);
    this.simulation = context.createGain();
    this.simulation.gain.value = 0;
    this.simulation.connect(this.master);
    this.whistleBus = context.createGain();
    this.whistleBus.gain.value = 0;
    this.whistleBus.connect(this.master);
    for (const [name, frequency, q, pan] of [
      ["rolling", 180, 0.6, -0.15],
      ["fire", 140, 0.8, -0.2],
      ["hiss", 2600, 0.6, 0.15],
      ["exhaustHiss", 1100, 0.6, 0],
      ["blowdown", 450, 0.7, -0.15],
      ["breath", 2200, 0.8, 0],
    ] as const) {
      const source = context.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = context.createGain();
      gain.gain.value = 0;
      const stereo = context.createStereoPanner();
      stereo.pan.value = pan;
      source
        .connect(filter)
        .connect(gain)
        .connect(stereo)
        .connect(name === "breath" ? this.whistleBus : this.simulation);
      source.start(0, Math.random());
      this.layers[name] = { gain, filter };
    }
    this.createScreech(context);
    for (const frequency of [440, 880, 1320]) {
      const tone = context.createOscillator();
      tone.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = 0;
      tone.connect(gain).connect(this.whistleBus);
      tone.start();
      this.whistleTones.push(gain);
    }
    context.addEventListener("statechange", () => {
      if (context.state === "suspended" || context.state === "interrupted")
        this.status("Sound is suspended. Use Retry sound to resume.", true);
    });
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Shared stick-slip friction voice for braking and spinning wheels. */
  private createScreech(context: AudioContext): void {
    const mix = context.createGain();
    const distortion = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (2 * i) / (curve.length - 1) - 1;
      curve[i] = Math.tanh(3.5 * x) * 0.7;
    }
    distortion.curve = curve;
    distortion.oversample = "2x";
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 550;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 5200;
    const flutter = context.createGain();
    flutter.gain.value = 0.72;
    this.screechGain = context.createGain();
    this.screechGain.gain.value = 0;
    mix
      .connect(distortion)
      .connect(highpass)
      .connect(lowpass)
      .connect(flutter)
      .connect(this.screechGain)
      .connect(this.simulation!);

    const wobble = context.createOscillator();
    wobble.frequency.value = 6.7;
    const wobbleDepth = context.createGain();
    wobbleDepth.gain.value = 34;
    wobble.connect(wobbleDepth);
    const jitter = context.createBufferSource();
    jitter.buffer = this.noise!;
    jitter.loop = true;
    const jitterFilter = context.createBiquadFilter();
    jitterFilter.type = "lowpass";
    jitterFilter.frequency.value = 35;
    const jitterDepth = context.createGain();
    jitterDepth.gain.value = 170;
    jitter.connect(jitterFilter).connect(jitterDepth);
    // Noninteger intervals, sawtooth harmonics and noisy detuning avoid a whistle-like note.
    for (const [ratio, level] of [
      [1, 0.2],
      [1.417, 0.16],
      [2.173, 0.11],
      [2.791, 0.07],
    ]) {
      const tone = context.createOscillator();
      tone.type = "sawtooth";
      tone.frequency.value = 780 * ratio!;
      const gain = context.createGain();
      gain.gain.value = level!;
      wobbleDepth.connect(tone.detune);
      jitterDepth.connect(tone.detune);
      tone.connect(gain).connect(mix);
      tone.start();
      this.screechTones.push({ tone, ratio: ratio! });
    }
    const rasp = context.createBufferSource();
    rasp.buffer = this.noise!;
    rasp.loop = true;
    const raspFilter = context.createBiquadFilter();
    raspFilter.type = "bandpass";
    raspFilter.frequency.value = 2300;
    raspFilter.Q.value = 2.5;
    const raspGain = context.createGain();
    raspGain.gain.value = 0.17;
    rasp.connect(raspFilter).connect(raspGain).connect(mix);
    for (const [frequency, depth] of [
      [43, 0.17],
      [9.3, 0.1],
    ]) {
      const flutterTone = context.createOscillator();
      flutterTone.frequency.value = frequency!;
      const flutterDepth = context.createGain();
      flutterDepth.gain.value = depth!;
      flutterTone.connect(flutterDepth).connect(flutter.gain);
      flutterTone.start();
    }
    wobble.start();
    jitter.start();
    rasp.start();
  }

  private apply(): void {
    const p = this.plan;
    if (!p || !this.context || this.failed) return;
    this.ramp(this.master, p.volume);
    this.ramp(this.simulation, p.active ? 1 : 0);
    this.ramp(this.whistleBus, 1);
    for (const name of ["rolling", "fire", "hiss", "exhaustHiss", "blowdown"] as const)
      this.ramp(this.layers[name]?.gain, p[name]);
    this.ramp(this.layers.breath?.gain, p.whistleBreath * 0.035);
    this.whistleTones.forEach((gain, i) => this.ramp(gain, p.whistle * [0.12, 0.04, 0.018][i]!));
    this.ramp(this.screechGain, Math.hypot(p.brake, p.slip));
    for (const { tone, ratio } of this.screechTones)
      tone.frequency.setTargetAtTime(p.brakeHz * ratio, this.context.currentTime, 0.06);
    if (!p.active || p.volume === 0) {
      this.nextBeat = 0;
      this.nextClack = 0;
    }
  }

  private burst(
    time: number,
    duration: number,
    volume: number,
    frequency: number,
    pan: number,
  ): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noise!;
    // Never resample: acceleration changes event timing/envelopes, not pitch.
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.75;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + Math.min(0.004, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    const stereo = context.createStereoPanner();
    stereo.pan.value = pan;
    source.connect(filter).connect(gain).connect(stereo).connect(this.simulation!);
    source.start(time, Math.random());
    source.stop(time + duration + 0.005);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      stereo.disconnect();
    };
  }

  private railKnock(time: number, volume: number, playback: number): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.railImpact!;
    const envelope = context.createGain();
    const duration = 0.62 / playback;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(volume, time + 0.002);
    envelope.gain.setValueAtTime(volume, time + duration * 0.65);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(envelope).connect(this.simulation!);
    source.start(time);
    source.stop(time + duration + 0.005);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
    };
  }

  private schedule(): void {
    const p = this.plan,
      context = this.context;
    if (!context || context.state !== "running" || !p || !p.active || p.volume === 0 || this.failed)
      return;
    const now = context.currentTime;
    try {
      if (p.beatHz > 0) {
        if (this.beatHz > 0 && this.nextBeat > now)
          this.nextBeat = now + ((this.nextBeat - now) * this.beatHz) / p.beatHz;
        this.nextBeat = Math.max(now, this.nextBeat);
        while (this.nextBeat < now + 0.06) {
          const accent = [1, 0.88, 0.96, 0.83][this.beat++ % 4]!;
          this.burst(
            this.nextBeat,
            Math.max(0.012, p.beatDuration),
            p.beatGain * accent,
            800 + Math.random() * 250,
            0,
          );
          this.nextBeat += 1 / p.beatHz;
        }
      } else this.nextBeat = 0;
      this.beatHz = p.beatHz;
      if (p.clackHz > 0) {
        if (this.clackHz > 0 && this.nextClack > now)
          this.nextClack = now + ((this.nextClack - now) * this.clackHz) / p.clackHz;
        this.nextClack = Math.max(now, this.nextClack);
        while (this.nextClack < now + 0.06) {
          this.railKnock(this.nextClack, p.clackGain, p.textureRate);
          this.railKnock(this.nextClack + p.clackGap, p.clackGain * 0.85, p.textureRate);
          this.nextClack += 1 / p.clackHz;
        }
      } else this.nextClack = 0;
      this.clackHz = p.clackHz;
      // A gentle changing fire texture; frequency follows simulated time rate.
      this.ramp(
        this.layers.fire?.gain,
        p.fire * (0.7 + 0.3 * Math.sin(now * 17 * p.textureRate) ** 8),
      );
    } catch {
      this.failed = true;
      this.silence();
      this.status("Audio stopped unexpectedly. Use Retry sound to resume.", true);
    }
  }

  silence(): void {
    this.ramp(this.master, 0);
    this.nextBeat = this.nextClack = 0;
  }

  dispose(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.silence();
    void this.context?.close();
  }
}
