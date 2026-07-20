(() => {
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const BUFFER_SIZE = 4096;         // ~93ms window @ 44.1kHz
  const RMS_SILENCE_THRESHOLD = 0.003; // lowered so quiet plucks/notes aren't skipped outright
  const WHITE_KEY_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  // Black-key left offsets as a percentage of the 7-white-key-wide keyboard,
  // centered on the boundary between the two white keys each sits above.
  const BLACK_KEYS = [
    { name: 'C♯', left: 10.0 },
    { name: 'D♯', left: 24.28 },
    { name: 'F♯', left: 52.85 },
    { name: 'G♯', left: 67.14 },
    { name: 'A♯', left: 81.42 },
  ];

  const els = {
    landing: document.getElementById('landing'),
    tuner: document.getElementById('tuner'),
    backBtn: document.getElementById('backBtn'),
    tunerTitle: document.getElementById('tunerTitle'),
    toggleBtn: document.getElementById('toggleBtn'),
    a4Control: document.getElementById('a4Control'),
    a4Input: document.getElementById('a4Input'),
    capoControl: document.getElementById('capoControl'),
    capoSelect: document.getElementById('capoSelect'),
    status: document.getElementById('status'),
    display: document.getElementById('display'),
    noteName: document.getElementById('noteName'),
    octave: document.getElementById('octave'),
    stringLabel: document.getElementById('stringLabel'),
    pianoKeyboard: document.getElementById('pianoKeyboard'),
    keyboardOctave: document.getElementById('keyboardOctave'),
    keyboardKeys: document.getElementById('keyboardKeys'),
    needle: document.getElementById('needle'),
    cents: document.getElementById('cents'),
    frequency: document.getElementById('frequency'),
    signalSection: document.getElementById('signalSection'),
    signalBar: document.getElementById('signalBar'),
    waveform: document.getElementById('waveform'),
    notesSection: document.getElementById('notesSection'),
    tuningSelect: document.getElementById('tuningSelect'),
    noteList: document.getElementById('noteList'),
    customEditor: document.getElementById('customEditor'),
    customRows: document.getElementById('customRows'),
    applyCustomBtn: document.getElementById('applyCustomBtn'),
  };
  const waveformCtx = els.waveform.getContext('2d');

  const STORAGE_KEY = 'instrument-tuner:lastState';

  let config = null;
  let currentInstrumentKey = null;
  let activeTuning = null;      // notes array for the currently selected tuning (guitar only)
  let lastCustomNotes = null;   // most recently applied custom-tuning notes
  let playbackContext = null;   // separate AudioContext for reference-tone playback
  let playbackOsc = null;
  let playbackButton = null;
  let audioContext = null;
  let analyser = null;
  let micStream = null;
  let pitchDetector = null;
  let timeBuffer = null;
  let rafId = null;
  let isListening = false;
  let a4Frequency = 440;
  let capoFret = 0;
  let wakeLock = null;
  let recentFrequencies = [];
  let silentFrames = 0;

  let customRowRefs = [];
  const keyboardKeyEls = buildKeyboard();

  document.querySelectorAll('.instrument-card').forEach((card) => {
    card.addEventListener('click', () => selectInstrument(card.dataset.instrument));
  });

  els.backBtn.addEventListener('click', () => {
    if (isListening) stopListening();
    stopTone();
    els.tuner.classList.add('hidden');
    els.landing.classList.remove('hidden');
  });

  els.toggleBtn.addEventListener('click', () => (isListening ? stopListening() : startListening()));

  els.a4Input.addEventListener('change', () => {
    const value = parseFloat(els.a4Input.value);
    if (Number.isFinite(value) && value >= 415 && value <= 466) {
      a4Frequency = value;
      // Guitar's reference-note frequencies are stored relative to A4=440;
      // re-render the chips so their displayed Hz (and playback pitch)
      // scale along with the new reference pitch.
      if (config && config.tunings) refreshCurrentTuningDisplay();
      saveState();
    } else {
      els.a4Input.value = a4Frequency;
    }
  });

  els.tuningSelect.addEventListener('change', () => {
    if (els.tuningSelect.value === 'custom') {
      showCustomEditor();
    } else {
      applyTuning(els.tuningSelect.value);
    }
  });

  els.applyCustomBtn.addEventListener('click', () => applyCustomTuning());

  els.capoSelect.addEventListener('change', () => {
    capoFret = parseInt(els.capoSelect.value, 10) || 0;
    refreshCurrentTuningDisplay();
    saveState();
  });

  function refreshCurrentTuningDisplay() {
    if (els.tuningSelect.value === 'custom') {
      if (lastCustomNotes) renderNoteChips(lastCustomNotes);
    } else {
      applyTuning(els.tuningSelect.value);
    }
  }

  function selectInstrument(instrumentKey, restore = {}) {
    config = INSTRUMENTS[instrumentKey];
    currentInstrumentKey = instrumentKey;
    a4Frequency = restore.a4 ?? 440;
    els.a4Input.value = a4Frequency;
    capoFret = restore.capo ?? 0;
    els.capoSelect.value = String(capoFret);

    els.tunerTitle.textContent = `${config.label} Tuner`;
    els.a4Control.classList.toggle('hidden', !config.showA4Input);
    els.capoControl.classList.toggle('hidden', !config.tunings);
    els.signalSection.classList.toggle('hidden', !config.showSignalMeter);
    els.waveform.classList.toggle('hidden', !config.showWaveform);
    els.notesSection.classList.toggle('hidden', !config.tunings);
    els.pianoKeyboard.classList.toggle('hidden', !config.showKeyboard);
    els.status.textContent = config.statusPrompt;
    els.stringLabel.classList.add('hidden');
    clearKeyboardHighlight();

    els.tuningSelect.innerHTML = '';
    if (config.tunings) {
      Object.entries(config.tunings).forEach(([tuningKey, tuning]) => {
        const option = document.createElement('option');
        option.value = tuningKey;
        option.textContent = tuning.label;
        els.tuningSelect.appendChild(option);
      });
      const customOption = document.createElement('option');
      customOption.value = 'custom';
      customOption.textContent = 'Custom…';
      els.tuningSelect.appendChild(customOption);

      const canRestoreCustom = restore.tuning === 'custom' && Array.isArray(restore.customNotes);
      const initialTuning = canRestoreCustom || (restore.tuning && config.tunings[restore.tuning])
        ? restore.tuning
        : config.defaultTuning;
      els.tuningSelect.value = initialTuning;

      if (canRestoreCustom) {
        lastCustomNotes = restore.customNotes;
        customRowRefs = buildCustomRows(lastCustomNotes.length);
        populateCustomRows(lastCustomNotes);
        els.customEditor.classList.add('hidden');
        els.noteList.classList.remove('hidden');
        renderNoteChips(lastCustomNotes);
      } else {
        applyTuning(initialTuning);
      }
    } else {
      activeTuning = null;
      els.noteList.innerHTML = '';
    }

    els.landing.classList.add('hidden');
    els.tuner.classList.remove('hidden');
    saveState();
  }

  function saveState() {
    if (!currentInstrumentKey) return;
    try {
      const state = {
        instrument: currentInstrumentKey,
        tuning: els.tuningSelect.value || null,
        a4: a4Frequency,
        capo: capoFret,
      };
      if (els.tuningSelect.value === 'custom' && lastCustomNotes) {
        state.customNotes = lastCustomNotes;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage unavailable (private browsing, disabled storage, etc.) — ignore
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function applyTuning(tuningKey) {
    stopTone();
    els.customEditor.classList.add('hidden');
    els.noteList.classList.remove('hidden');
    renderNoteChips(config.tunings[tuningKey].notes);
    saveState();
  }

  function renderNoteChips(notes) {
    activeTuning = notes;
    els.noteList.innerHTML = '';
    activeTuning.forEach((n, i) => {
      const chip = document.createElement('div');
      chip.className = 'string-chip';
      chip.id = `note-${i}`;
      chip.innerHTML = `
        <button type="button" class="chip-play" aria-label="Play ${n.name}${n.octave} reference tone">&#128266;</button>
        <span class="chip-note">${n.name}${n.octave}</span>
        <span class="freq">${effectiveFreq(n).toFixed(2)} Hz</span>
      `;
      const playBtn = chip.querySelector('.chip-play');
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTone(effectiveFreq(n), playBtn);
      });
      els.noteList.appendChild(chip);
    });
    els.stringLabel.classList.add('hidden');
    els.stringLabel.classList.remove('no-match');
  }

  function buildKeyboard() {
    const keyEls = {};
    WHITE_KEY_NAMES.forEach((name) => {
      const key = document.createElement('div');
      key.className = 'white-key';
      els.keyboardKeys.appendChild(key);
      keyEls[name] = key;
    });
    BLACK_KEYS.forEach(({ name, left }) => {
      const key = document.createElement('div');
      key.className = 'black-key';
      key.style.left = `${left}%`;
      els.keyboardKeys.appendChild(key);
      keyEls[name] = key;
    });
    return keyEls;
  }

  function updateKeyboardHighlight(name, octave) {
    Object.values(keyboardKeyEls).forEach((el) => el.classList.remove('active'));
    if (keyboardKeyEls[name]) keyboardKeyEls[name].classList.add('active');
    els.keyboardOctave.textContent = octave;
  }

  function clearKeyboardHighlight() {
    Object.values(keyboardKeyEls).forEach((el) => el.classList.remove('active'));
    els.keyboardOctave.textContent = '–';
  }

  function buildCustomRows(count) {
    els.customRows.innerHTML = '';
    const rows = [];
    for (let i = 0; i < count; i++) {
      const stringNum = count - i;
      const row = document.createElement('div');
      row.className = 'custom-row';

      const label = document.createElement('span');
      label.className = 'custom-row-label';
      label.textContent = `String ${stringNum}`;

      const nameSelect = document.createElement('select');
      nameSelect.className = 'custom-note-select';
      NOTE_NAMES.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        nameSelect.appendChild(opt);
      });

      const octaveInput = document.createElement('input');
      octaveInput.type = 'number';
      octaveInput.className = 'custom-octave-input';
      octaveInput.min = '0';
      octaveInput.max = '7';

      row.appendChild(label);
      row.appendChild(nameSelect);
      row.appendChild(octaveInput);
      els.customRows.appendChild(row);
      rows.push({ nameSelect, octaveInput, string: stringNum });
    }
    return rows;
  }

  function populateCustomRows(notes) {
    customRowRefs.forEach((row, i) => {
      const note = notes[i];
      if (!note) return;
      row.nameSelect.value = note.name;
      row.octaveInput.value = note.octave;
    });
  }

  function showCustomEditor() {
    stopTone();
    const notes = lastCustomNotes || activeTuning || config.tunings[config.defaultTuning].notes;
    customRowRefs = buildCustomRows(notes.length);
    populateCustomRows(notes);
    els.noteList.classList.add('hidden');
    els.customEditor.classList.remove('hidden');
  }

  function applyCustomTuning() {
    const notes = customRowRefs.map((row) => {
      const name = row.nameSelect.value;
      const octaveRaw = parseInt(row.octaveInput.value, 10);
      const octave = Number.isFinite(octaveRaw) ? Math.max(0, Math.min(7, octaveRaw)) : 3;
      row.octaveInput.value = octave;
      return { name, octave, freq: frequencyFromNote(name, octave), string: row.string };
    });
    lastCustomNotes = notes;
    els.customEditor.classList.add('hidden');
    els.noteList.classList.remove('hidden');
    renderNoteChips(notes);
    saveState();
  }

  function frequencyFromNote(name, octave) {
    const midi = (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function toggleTone(freq, button) {
    const wasThisButton = playbackButton === button;
    stopTone();
    if (wasThisButton) return; // second click on the same chip just stops it

    if (!playbackContext) playbackContext = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = playbackContext;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
    gain.gain.setValueAtTime(0.2, now + 1.1);
    gain.gain.linearRampToValueAtTime(0, now + 1.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(now + 1.35);

    button.classList.add('playing');
    playbackOsc = osc;
    playbackButton = button;
    osc.onended = () => {
      button.classList.remove('playing');
      if (playbackOsc === osc) {
        playbackOsc = null;
        playbackButton = null;
      }
    };
  }

  function stopTone() {
    if (playbackButton) playbackButton.classList.remove('playing');
    if (playbackOsc) {
      try {
        playbackOsc.stop();
      } catch (e) {
        // already stopped
      }
    }
    playbackOsc = null;
    playbackButton = null;
  }

  async function startListening() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      els.status.textContent =
        'Microphone access requires a secure context (open this over http://localhost, not file://).';
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      els.status.textContent = `Microphone access failed: ${err.message}`;
      return;
    }

    micStream = stream;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = BUFFER_SIZE;

    // Attenuate sub-range rumble/hum (mains hum, desk vibration, guitar-body
    // thump) *before* pitch detection sees it — excluding a frequency band
    // from the YIN search isn't enough on its own, since strong low-frequency
    // energy still distorts the waveform's periodicity near that boundary.
    // Two cascaded biquads give a steeper (~24 dB/octave) rolloff than one.
    const highpass1 = audioContext.createBiquadFilter();
    highpass1.type = 'highpass';
    highpass1.frequency.value = config.minFrequency;
    highpass1.Q.value = 0.707;
    const highpass2 = audioContext.createBiquadFilter();
    highpass2.type = 'highpass';
    highpass2.frequency.value = config.minFrequency;
    highpass2.Q.value = 0.707;
    source.connect(highpass1).connect(highpass2).connect(analyser);

    timeBuffer = new Float32Array(analyser.fftSize);
    pitchDetector = new PitchDetector(audioContext.sampleRate, {
      threshold: config.threshold,
      minFrequency: config.minFrequency,
      maxFrequency: config.maxFrequency,
    });

    isListening = true;
    recentFrequencies = [];
    silentFrames = 0;
    els.toggleBtn.textContent = 'Stop Tuning';
    els.toggleBtn.classList.add('listening');
    els.status.textContent = config.statusIdle;
    els.display.classList.remove('hidden');

    requestWakeLock();
    analyzeLoop();
  }

  function stopListening() {
    isListening = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;

    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    releaseWakeLock();

    els.toggleBtn.textContent = 'Start Tuning';
    els.toggleBtn.classList.remove('listening');
    els.status.textContent = config.statusPrompt;
    els.display.classList.add('hidden');
    clearNoteDisplay();
    clearActiveNote();
    els.signalBar.style.width = '0%';
    waveformCtx.clearRect(0, 0, els.waveform.width, els.waveform.height);
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      wakeLock = null; // e.g. denied, or tab not visible — best-effort only
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // The OS auto-releases the wake lock when the tab is backgrounded; if the
  // user comes back while still listening, re-acquire it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isListening && !wakeLock) {
      requestWakeLock();
    }
  });

  function analyzeLoop() {
    if (!isListening) return;

    analyser.getFloatTimeDomainData(timeBuffer);
    if (config.showWaveform) drawWaveform(timeBuffer);

    const rms = computeRMS(timeBuffer);
    if (config.showSignalMeter) els.signalBar.style.width = `${signalMeterWidth(rms)}%`;

    // Skip the (relatively expensive) YIN search entirely on silence.
    const result = rms >= RMS_SILENCE_THRESHOLD ? pitchDetector.detectPitch(timeBuffer) : null;

    // Strong sub-range noise (mains hum, desk rumble, body resonance) can
    // still make the search "clamp" to the very edge of the allowed
    // frequency band rather than correctly finding nothing. That clamped
    // result always lands within a hair of minFrequency itself — genuine
    // notes always land meaningfully above it, at their real frequency —
    // so treat anything suspiciously close to the floor as untrustworthy,
    // regardless of its (sometimes deceptively high) clarity score.
    const isBoundaryArtifact = result && result.frequency < config.minFrequency * 1.03;

    const requiredClarity = result ? requiredClarityFor(result.frequency) : config.clarityThreshold;

    if (result && !isBoundaryArtifact && result.clarity >= requiredClarity) {
      silentFrames = 0;
      recentFrequencies.push(correctOctaveDownError(result.frequency));
      if (recentFrequencies.length > config.smoothingWindow) recentFrequencies.shift();
      updateNoteDisplay(median(recentFrequencies));
      els.status.textContent = config.statusIdle;
    } else {
      silentFrames++;
      if (silentFrames > config.silenceFramesToClear) {
        recentFrequencies = [];
        clearNoteDisplay();
        clearActiveNote();
      }
    }

    rafId = requestAnimationFrame(analyzeLoop);
  }

  function frequencyToNote(frequency, a4) {
    const midiFloat = 69 + 12 * Math.log2(frequency / a4);
    const midi = Math.round(midiFloat);
    const cents = (midiFloat - midi) * 100;
    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const octave = Math.floor(midi / 12) - 1;
    return { name, octave, cents };
  }

  function updateNoteDisplay(frequency) {
    const { name, octave, cents } = frequencyToNote(frequency, a4Frequency);

    els.noteName.textContent = name;
    els.octave.textContent = octave;
    els.frequency.textContent = `${frequency.toFixed(2)} Hz`;
    els.cents.textContent = `${cents >= 0 ? '+' : '−'}${Math.abs(cents).toFixed(1)} cents`;

    const clamped = Math.max(-50, Math.min(50, cents));
    els.needle.style.left = `${((clamped + 50) / 100) * 100}%`;

    const absCents = Math.abs(cents);
    els.needle.classList.remove('in-tune', 'close', 'off');
    if (absCents <= 5) els.needle.classList.add('in-tune');
    else if (absCents <= 15) els.needle.classList.add('close');
    else els.needle.classList.add('off');
    els.noteName.style.color = absCents <= 5 ? 'var(--in-tune)' : 'var(--text)';

    if (activeTuning) highlightClosestNote(frequency);
    if (config.showKeyboard) updateKeyboardHighlight(name, octave);
  }

  function clearNoteDisplay() {
    els.noteName.textContent = '–';
    els.octave.textContent = '';
    els.frequency.textContent = '– Hz';
    els.cents.textContent = '– cents';
    els.needle.style.left = '50%';
    els.needle.classList.remove('in-tune', 'close', 'off');
    els.noteName.style.color = '';
    if (config.showKeyboard) clearKeyboardHighlight();
  }

  function effectiveFreq(note) {
    // Reference notes are stored relative to A4=440; scaling uniformly by
    // a4Frequency/440 keeps every note's 12-TET ratio to A4 correct under a
    // different reference pitch, without needing a per-note MIDI lookup.
    // A capo raises the sounding pitch of every open string by the same
    // number of semitones, so multiply in that ratio too.
    const capoScale = Math.pow(2, capoFret / 12);
    return note.freq * (a4Frequency / 440) * capoScale;
  }

  function findClosestTuningMatch(freq) {
    let closestIndex = -1;
    let closestCents = Infinity;
    activeTuning.forEach((n, i) => {
      const diff = Math.abs(1200 * Math.log2(freq / effectiveFreq(n)));
      if (diff < closestCents) {
        closestCents = diff;
        closestIndex = i;
      }
    });
    return { closestIndex, closestCents };
  }

  // YIN's "keep walking while the difference function decreases" search can
  // occasionally settle on double the true period (half the true frequency)
  // instead of the fundamental — a well-known octave-down failure mode,
  // most visible on strings with a weak fundamental relative to their
  // harmonics (e.g. a thin, quietly-plucked high string). We can't safely
  // "always prefer double the frequency" at the detector level — that would
  // wrongly reinterpret a genuine low string as its own real 2nd harmonic —
  // but at the matching level we know the *specific* set of valid target
  // pitches, so: if doubling a poorly-matching reading suddenly lands it
  // almost exactly on a real target it wasn't close to before, that's
  // strong, low-risk evidence of exactly this error.
  function correctOctaveDownError(freq) {
    if (!activeTuning) return freq;
    const raw = findClosestTuningMatch(freq);
    const doubled = findClosestTuningMatch(freq * 2);
    if (doubled.closestCents < 50 && doubled.closestCents < raw.closestCents - 100) {
      // Ambiguity guard: if this same frequency is *also* explainable as a
      // different string's own 2nd harmonic (i.e. half of it lands on some
      // other target), we can't tell whether the true note is the higher
      // string read an octave low, or the lower string read an octave high
      // — e.g. standard tuning's E2 and E4 are exactly two octaves apart,
      // so E2's 2nd harmonic and E4's octave-down error are the same
      // frequency. Guessing wrong here is worse than not correcting at all.
      const halved = findClosestTuningMatch(freq / 2);
      const isAmbiguous = halved.closestCents < 50 && halved.closestIndex !== doubled.closestIndex;
      if (!isAmbiguous) return freq * 2;
    }
    return freq;
  }

  function highlightClosestNote(freq) {
    const { closestIndex, closestCents } = findClosestTuningMatch(freq);
    // Only mark a reference note "active" if we're within 1.5 semitones —
    // avoids mislabeling overtones/harmonics as the wrong string.
    const isConfidentMatch = closestIndex !== -1 && closestCents < 150;
    activeTuning.forEach((_, i) => {
      document.getElementById(`note-${i}`).classList.toggle('active', i === closestIndex && isConfidentMatch);
    });

    if (isConfidentMatch) {
      const note = activeTuning[closestIndex];
      els.stringLabel.textContent = `${ordinal(note.string)} String — ${stringNickname(note)}`;
      els.stringLabel.classList.remove('hidden', 'no-match');
    } else {
      // A pitch was confidently detected, it just isn't one of this
      // tuning's strings (e.g. a fretted note, or a 7th/extra string) —
      // say so instead of silently showing nothing.
      els.stringLabel.textContent = 'Not part of this tuning';
      els.stringLabel.classList.remove('hidden');
      els.stringLabel.classList.add('no-match');
    }
  }

  function clearActiveNote() {
    if (!activeTuning) return;
    activeTuning.forEach((_, i) => document.getElementById(`note-${i}`).classList.remove('active'));
    els.stringLabel.classList.add('hidden');
    els.stringLabel.classList.remove('no-match');
  }

  function stringNickname(note) {
    // "Low X"/"High X" only makes sense for a linear string order (pitch
    // rising monotonically from the highest string number down to 1). Some
    // tunings are reentrant — e.g. standard ukulele's G string (string 4)
    // is pitched *above* its C string (string 3) — where those labels
    // would be actively misleading, so fall back to the plain note name.
    if (!isLinearTuning(activeTuning)) return note.name;
    const lowestString = Math.max(...activeTuning.map((n) => n.string));
    if (note.string === lowestString) return `Low ${note.name}`;
    if (note.string === 1) return `High ${note.name}`;
    return note.name;
  }

  function isLinearTuning(notes) {
    const byStringDesc = [...notes].sort((a, b) => b.string - a.string);
    for (let i = 1; i < byStringDesc.length; i++) {
      if (byStringDesc[i].freq <= byStringDesc[i - 1].freq) return false;
    }
    return true;
  }

  function ordinal(n) {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  }

  function computeRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }

  function requiredClarityFor(frequency) {
    const gradient = config.clarityGradient;
    if (!gradient) return config.clarityThreshold;
    const { startFreq, endFreq, startClarity, endClarity } = gradient;
    if (frequency <= startFreq) return startClarity;
    if (frequency >= endFreq) return endClarity;
    const t = (frequency - startFreq) / (endFreq - startFreq);
    return startClarity + t * (endClarity - startClarity);
  }

  // A linear rms->width mapping makes quiet-but-perfectly-detectable input
  // (an unamplified acoustic instrument through a laptop mic, common since
  // we disable autoGainControl for cleaner pitch detection) look almost
  // empty. A square-root curve reads much closer to perceived loudness;
  // full width now hits around rms=0.06, a moderate pluck/note, so typical
  // playing levels read as solidly "heard" rather than lost near the bottom.
  function signalMeterWidth(rms) {
    const SIGNAL_METER_FULL_RMS = 0.06;
    return Math.min(100, Math.sqrt(rms / SIGNAL_METER_FULL_RMS) * 100);
  }

  function drawWaveform(buffer) {
    const { width, height } = els.waveform;
    waveformCtx.clearRect(0, 0, width, height);
    waveformCtx.strokeStyle = '#4f8cff';
    waveformCtx.lineWidth = 1.5;
    waveformCtx.beginPath();

    const step = Math.max(1, Math.floor(buffer.length / width));
    for (let x = 0, i = 0; x < width && i < buffer.length; x++, i += step) {
      const y = (1 - (buffer[i] + 1) / 2) * height;
      if (x === 0) waveformCtx.moveTo(x, y);
      else waveformCtx.lineTo(x, y);
    }
    waveformCtx.stroke();
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  const saved = loadState();
  if (saved && INSTRUMENTS[saved.instrument]) {
    selectInstrument(saved.instrument, {
      tuning: saved.tuning,
      a4: saved.a4,
      capo: saved.capo,
      customNotes: saved.customNotes,
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
