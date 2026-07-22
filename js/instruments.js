const INSTRUMENTS = {
  guitar: {
    label: 'Guitar',
    icon: '🎸',
    minFrequency: 70,           // kept above 60 Hz (mains hum / desk-rumble range) — a weak,
                                 // quiet high string can otherwise let clean low-frequency noise
                                 // outscore it, since narrowband hum reads as *very* periodic
                                 // (higher YIN clarity than a real, harmonically complex note)
    maxFrequency: 400,          // just above the highest string — kept tight so the search can
                                 // never lock onto a string's own 2nd/3rd harmonic (e.g. E4's
                                 // 2nd harmonic at 659 Hz), which caused octave errors
    threshold: 0.25,            // loosened further from 0.15 — real strings (especially the
                                 // high E) can fail to clear a strict threshold even on a firm
                                 // pluck; safe to loosen since false positives are now caught
                                 // by the boundary-artifact guard and frequency-range capping
                                 // below, rather than resting on this threshold alone
    clarityThreshold: 0.55,
    smoothingWindow: 4,
    silenceFramesToClear: 20,   // ~0.35s of no valid pitch before the display clears
    defaultTuning: 'standard',
    tunings: {
      standard: {
        label: 'Standard (E A D G B E)',
        notes: [
          { name: 'E', octave: 2, freq: 82.41, string: 6 },
          { name: 'A', octave: 2, freq: 110.00, string: 5 },
          { name: 'D', octave: 3, freq: 146.83, string: 4 },
          { name: 'G', octave: 3, freq: 196.00, string: 3 },
          { name: 'B', octave: 3, freq: 246.94, string: 2 },
          { name: 'E', octave: 4, freq: 329.63, string: 1 },
        ],
      },
      dropD: {
        label: 'Drop D (D A D G B E)',
        notes: [
          { name: 'D', octave: 2, freq: 73.42, string: 6 },
          { name: 'A', octave: 2, freq: 110.00, string: 5 },
          { name: 'D', octave: 3, freq: 146.83, string: 4 },
          { name: 'G', octave: 3, freq: 196.00, string: 3 },
          { name: 'B', octave: 3, freq: 246.94, string: 2 },
          { name: 'E', octave: 4, freq: 329.63, string: 1 },
        ],
      },
      halfStepDown: {
        label: 'Half Step Down (D♯ G♯ C♯ F♯ A♯ D♯)',
        notes: [
          { name: 'D♯', octave: 2, freq: 77.78, string: 6 },
          { name: 'G♯', octave: 2, freq: 103.83, string: 5 },
          { name: 'C♯', octave: 3, freq: 138.59, string: 4 },
          { name: 'F♯', octave: 3, freq: 185.00, string: 3 },
          { name: 'A♯', octave: 3, freq: 233.08, string: 2 },
          { name: 'D♯', octave: 4, freq: 311.13, string: 1 },
        ],
      },
      openG: {
        label: 'Open G (D G D G B D)',
        notes: [
          { name: 'D', octave: 2, freq: 73.42, string: 6 },
          { name: 'G', octave: 2, freq: 98.00, string: 5 },
          { name: 'D', octave: 3, freq: 146.83, string: 4 },
          { name: 'G', octave: 3, freq: 196.00, string: 3 },
          { name: 'B', octave: 3, freq: 246.94, string: 2 },
          { name: 'D', octave: 4, freq: 293.66, string: 1 },
        ],
      },
      openD: {
        label: 'Open D (D A D F♯ A D)',
        notes: [
          { name: 'D', octave: 2, freq: 73.42, string: 6 },
          { name: 'A', octave: 2, freq: 110.00, string: 5 },
          { name: 'D', octave: 3, freq: 146.83, string: 4 },
          { name: 'F♯', octave: 3, freq: 185.00, string: 3 },
          { name: 'A', octave: 3, freq: 220.00, string: 2 },
          { name: 'D', octave: 4, freq: 293.66, string: 1 },
        ],
      },
      dadgad: {
        label: 'DADGAD (D A D G A D)',
        notes: [
          { name: 'D', octave: 2, freq: 73.42, string: 6 },
          { name: 'A', octave: 2, freq: 110.00, string: 5 },
          { name: 'D', octave: 3, freq: 146.83, string: 4 },
          { name: 'G', octave: 3, freq: 196.00, string: 3 },
          { name: 'A', octave: 3, freq: 220.00, string: 2 },
          { name: 'D', octave: 4, freq: 293.66, string: 1 },
        ],
      },
    },
    showA4Input: true,
    showWaveform: false,
    showSignalMeter: true,
    statusIdle: 'Listening… play a single string',
    statusPrompt: 'Click "Start Tuning" and allow microphone access',
  },
  bass: {
    label: 'Bass Guitar',
    icon: '🎸',
    minFrequency: 27,           // just below B0 (30.87 Hz), the lowest note across supported tunings
    maxFrequency: 140,          // just above G2 (98 Hz) — kept tight so the search can't lock onto
                                 // a string's own 2nd harmonic (e.g. G2's at 196 Hz)
    threshold: 0.15,
    clarityThreshold: 0.8,
    smoothingWindow: 4,
    silenceFramesToClear: 20,
    defaultTuning: 'standard4',
    tunings: {
      standard4: {
        label: '4-String Standard (E A D G)',
        notes: [
          { name: 'E', octave: 1, freq: 41.20, string: 4 },
          { name: 'A', octave: 1, freq: 55.00, string: 3 },
          { name: 'D', octave: 2, freq: 73.42, string: 2 },
          { name: 'G', octave: 2, freq: 98.00, string: 1 },
        ],
      },
      standard5: {
        label: '5-String Standard (B E A D G)',
        notes: [
          { name: 'B', octave: 0, freq: 30.87, string: 5 },
          { name: 'E', octave: 1, freq: 41.20, string: 4 },
          { name: 'A', octave: 1, freq: 55.00, string: 3 },
          { name: 'D', octave: 2, freq: 73.42, string: 2 },
          { name: 'G', octave: 2, freq: 98.00, string: 1 },
        ],
      },
    },
    showA4Input: true,
    showWaveform: false,
    showSignalMeter: true,
    statusIdle: 'Listening… play a single string',
    statusPrompt: 'Click "Start Tuning" and allow microphone access',
  },
  ukulele: {
    label: 'Ukulele',
    icon: '🪕',
    minFrequency: 130,          // just below Baritone's low D3 (146.83 Hz), across all supported tunings
    maxFrequency: 500,          // just above A4 (440 Hz) — kept tight so the search can't lock onto
                                 // a string's own 2nd harmonic (e.g. A4's at 880 Hz)
    threshold: 0.15,
    clarityThreshold: 0.8,
    smoothingWindow: 4,
    silenceFramesToClear: 20,
    defaultTuning: 'standard',
    tunings: {
      standard: {
        label: 'Standard — High G (G C E A)',
        notes: [
          // Reentrant: string 4 (G4) is pitched *higher* than string 3 (C4) —
          // the "Low X / High X" nickname logic detects this isn't a linear
          // low-to-high string order and falls back to plain note names.
          { name: 'G', octave: 4, freq: 392.00, string: 4 },
          { name: 'C', octave: 4, freq: 261.63, string: 3 },
          { name: 'E', octave: 4, freq: 329.63, string: 2 },
          { name: 'A', octave: 4, freq: 440.00, string: 1 },
        ],
      },
      lowG: {
        label: 'Low G (G C E A)',
        notes: [
          { name: 'G', octave: 3, freq: 196.00, string: 4 },
          { name: 'C', octave: 4, freq: 261.63, string: 3 },
          { name: 'E', octave: 4, freq: 329.63, string: 2 },
          { name: 'A', octave: 4, freq: 440.00, string: 1 },
        ],
      },
      baritone: {
        label: 'Baritone (D G B E)',
        notes: [
          { name: 'D', octave: 3, freq: 146.83, string: 4 },
          { name: 'G', octave: 3, freq: 196.00, string: 3 },
          { name: 'B', octave: 3, freq: 246.94, string: 2 },
          { name: 'E', octave: 4, freq: 329.63, string: 1 },
        ],
      },
    },
    showA4Input: true,
    showWaveform: false,
    showSignalMeter: true,
    statusIdle: 'Listening… play a single string',
    statusPrompt: 'Click "Start Tuning" and allow microphone access',
  },
  violin: {
    label: 'Violin',
    icon: '🎻',
    minFrequency: 170,          // just below G3 (196.00 Hz), the lowest string
    maxFrequency: 750,          // just above E5 (659.26 Hz) — kept tight so the search can't
                                 // lock onto the E string's own 2nd harmonic (1318.52 Hz)
    threshold: 0.15,
    clarityThreshold: 0.8,
    smoothingWindow: 4,
    silenceFramesToClear: 20,
    defaultTuning: 'standard',
    tunings: {
      standard: {
        label: 'Standard (G D A E)',
        notes: [
          { name: 'G', octave: 3, freq: 196.00, string: 4 },
          { name: 'D', octave: 4, freq: 293.66, string: 3 },
          { name: 'A', octave: 4, freq: 440.00, string: 2 },
          { name: 'E', octave: 5, freq: 659.26, string: 1 },
        ],
      },
    },
    showA4Input: true,
    showWaveform: false,
    showSignalMeter: true,
    statusIdle: 'Listening… play a single string',
    statusPrompt: 'Click "Start Tuning" and allow microphone access',
  },
  viola: {
    label: 'Viola',
    icon: '🎻',
    minFrequency: 115,          // just below C3 (130.81 Hz), the lowest string
    maxFrequency: 500,          // just above A4 (440 Hz) — kept tight so the search can't lock
                                 // onto the A string's own 2nd harmonic (880 Hz)
    threshold: 0.15,
    clarityThreshold: 0.8,
    smoothingWindow: 4,
    silenceFramesToClear: 20,
    defaultTuning: 'standard',
    tunings: {
      standard: {
        label: 'Standard (C G D A)',
        notes: [
          { name: 'C', octave: 3, freq: 130.81, string: 4 },
          { name: 'G', octave: 3, freq: 196.00, string: 3 },
          { name: 'D', octave: 4, freq: 293.66, string: 2 },
          { name: 'A', octave: 4, freq: 440.00, string: 1 },
        ],
      },
    },
    showA4Input: true,
    showWaveform: false,
    showSignalMeter: true,
    statusIdle: 'Listening… play a single string',
    statusPrompt: 'Click "Start Tuning" and allow microphone access',
  },
  cello: {
    label: 'Cello',
    icon: '🎻',
    minFrequency: 63,            // just above 60 Hz mains hum — cello's C string (65.41 Hz) sits
                                  // much closer to the hum band than any other instrument here,
                                  // so there's less margin to work with than usual. Keeping the
                                  // floor *above* 60 Hz (not just close to it) is what actually
                                  // matters: it structurally excludes hum from ever being a valid
                                  // in-range candidate, rather than just relying on the boundary-
                                  // artifact guard to catch it after the fact. Trade-off: a very
                                  // flat C string (more than ~1 semitone flat) may briefly read as
                                  // nothing until it's tuned up closer to pitch.
    maxFrequency: 260,           // just above A3 (220 Hz) — kept tight so the search can't lock
                                  // onto the A string's own 2nd harmonic (440 Hz)
    threshold: 0.15,
    clarityThreshold: 0.8,
    smoothingWindow: 4,
    silenceFramesToClear: 20,
    defaultTuning: 'standard',
    tunings: {
      standard: {
        label: 'Standard (C G D A)',
        notes: [
          { name: 'C', octave: 2, freq: 65.41, string: 4 },
          { name: 'G', octave: 2, freq: 98.00, string: 3 },
          { name: 'D', octave: 3, freq: 146.83, string: 2 },
          { name: 'A', octave: 3, freq: 220.00, string: 1 },
        ],
      },
    },
    showA4Input: true,
    showWaveform: false,
    showSignalMeter: true,
    statusIdle: 'Listening… play a single string',
    statusPrompt: 'Click "Start Tuning" and allow microphone access',
  },
  piano: {
    label: 'Piano',
    icon: '🎹',
    minFrequency: 25,           // just below A0 (27.5 Hz)
    maxFrequency: 4500,         // just above C8 (4186 Hz)
    threshold: 0.2,             // loosened from 0.15 — the highest piano octaves have a
                                 // well-known weak-fundamental/strong-upper-partial character
                                 // (string inharmonicity), which a strict threshold rejects
                                 // outright even on a clean, well-mic'd note
    clarityThreshold: 0.7,      // loosened from 0.9 for the same reason; still guarded by the
                                 // boundary-artifact check and frequency-range capping rather
                                 // than resting on this threshold alone
    clarityGradient: {           // piano inharmonicity is a *gradual* effect across the upper
                                  // register, not a sharp cutoff at any one note — a hard
                                  // two-tier boundary left real gaps (e.g. D7/D♯7 just below
                                  // it), so the confidence bar instead relaxes smoothly as
                                  // frequency rises. High-frequency false positives from real
                                  // noise are inherently rare, so this is safe to push far.
      startFreq: 1000,
      endFreq: 4500,
      startClarity: 0.7,
      endClarity: 0.35,
    },
    smoothingWindow: 6,
    silenceFramesToClear: 40,   // ~0.7s of no valid pitch before the display clears
    defaultTuning: null,
    tunings: null,              // 88 keys — no fixed reference chip list or alternate tunings
    showA4Input: true,
    showWaveform: true,
    showSignalMeter: true,
    showKeyboard: true,          // no fixed string chips to show the target — a keyboard graphic
                                  // gives the same "here's what you're tuning" visual instead
    statusIdle: 'Listening… play a single note close to the microphone in a quiet room.',
    statusPrompt: 'Click "Start Tuning", allow microphone access, then play a single note.',
  },
};
