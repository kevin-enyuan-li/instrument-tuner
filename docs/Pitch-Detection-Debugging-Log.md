# Pitch Detection Debugging Log

This is a field report of the specific weaknesses of the YIN algorithm we ran
into while building this tuner, how each was diagnosed, and exactly what was
changed to address it. See
[YIN-Pitch-Detection-Algorithm.md](YIN-Pitch-Detection-Algorithm.md) for how
the algorithm works in the first place; this document is the debugging
history behind the extra logic layered on top of it in `app.js` and
`instruments.js`.

Every fix below follows the same shape: a real, reported symptom → a
reproduction attempt (usually a synthetic Node.js script exercising
`pitchDetector.js` directly, occasionally a full Playwright browser test) →
a root-cause hypothesis → a targeted fix → re-verification against both the
new case and the full existing regression suite, so a fix for one instrument
never silently broke another. One case was **not** resolved, and is
documented honestly as open, rather than papered over.

---

## 1. Octave-up error: locking onto a string's own harmonic

**Symptom.** Guitar's high E string (E4, 329.63 Hz) intermittently read as
the wrong note entirely, or failed to register.

**Diagnosis.** YIN's search scans lag τ from small to large (high frequency
to low) and stops at the *first* dip that clears the absolute threshold. If
a string's true fundamental produces a shallow dip — common for a thin,
brightly-toned, quietly-plucked string — the scan can walk straight past it
and lock onto a strong harmonic instead, since the harmonic's own dip
(smaller τ) is encountered *first*. Reproduced synthetically with a
weak-fundamental + strong-2nd-harmonic signal at E4: with the original wide
search range (60–1200 Hz), the detector reported **661.39 Hz** (1206 cents
off — an octave error onto the 2nd harmonic) instead of 329.63 Hz.

**Fix.** Capped each instrument's `maxFrequency` just above its own highest
target note, so a string's own 2nd/3rd harmonics are never even inside the
search range — the algorithm can't lock onto what it can't see. Guitar went
from `maxFrequency: 1200` to `maxFrequency: 400`; every instrument added
afterward (bass, ukulele, violin, viola) was given the same treatment from
the start, each capped just above its own highest string.

**Verification.** Re-ran the same weak-fundamental synthetic signal with the
narrowed range: detector correctly reported 329.63 Hz. Confirmed the same
technique protects bass's G2 and, later, violin's E5 and viola's A4 against
the identical failure mode using the same adversarial synthetic profile.

---

## 2. General insensitivity: quiet, realistic signals rejected outright

**Symptom.** Several strings failed to register at low playing volume, even
though they were audible.

**Diagnosis.** The original settings (YIN `threshold: 0.1`,
`clarityThreshold: 0.9`) were tuned against clean synthetic tones, not real
signals with modest noise and natural inharmonicity. A synthetic "quiet
pluck" test (amplitude ≈ 0.012, realistic harmonic content, light noise)
found only **2 of 6** guitar strings detected at all under the original
thresholds.

**Fix.** Loosened both gates: `threshold` 0.1 → 0.15, `clarityThreshold`
0.9 → 0.8 (guitar was later loosened further still — see §7).

**Verification.** The same quiet-pluck test found **6 of 6** strings
detected after loosening. Cross-checked against pure background noise at
several amplitudes to confirm the looser gate didn't introduce false
positives (0/30 false positives across tested noise levels).

---

## 3. The "Input level" meter looked broken even when detection worked

**Symptom.** The visual level meter barely moved for quiet-but-perfectly-
detected input, making the app look unresponsive even when it wasn't.

**Diagnosis.** This wasn't a detection bug at all — the meter used a linear
`rms × 400` mapping. At `rms = 0.011` (comfortably above the detection
floor), that's only ~4% bar width.

**Fix.** Replaced the linear mapping with a square-root curve
(`signalMeterWidth()`), which reads much closer to perceived loudness. Later
tightened further by lowering the "full bar" reference point from
`rms = 0.15` to `rms = 0.06`, so a moderate note fills the bar rather than
requiring a fairly loud one.

**Verification.** The same `rms = 0.011` quiet-pluck case that used to show
~4% now shows ~43% (first pass) and ~71% (after the second tightening) —
purely a display change, confirmed to have zero effect on actual detection
behavior.

---

## 4. Low-frequency noise mistaken for a confident (but false) low note

**Symptom.** Playing the guitar's high E string quietly, with any ambient
low-frequency noise present (mic self-noise, desk rumble, room resonance),
sometimes produced a *confident, wrong* reading — most often something
around "C2" — instead of the correct note or silence.

**Diagnosis.** Two compounding effects, found by direct measurement:

- Narrowband noise (a near-pure low tone) is *more* periodic, in the CMND
  sense, than a real, harmonically complex musical note — so it can produce
  a **higher** clarity score than genuine playing. A synthetic weak-E4 +
  low-frequency-noise mix landed a false candidate at 65.88 Hz with
  clarity 0.9558, comfortably above the (already loosened) 0.8 gate.
- Independently, strong out-of-range noise can make the search "clamp" to
  the exact edge of the allowed τ range rather than correctly returning
  nothing — and that clamped result carries a deceptively high clarity
  score too (0.907–0.983 across several tested noise frequencies), all
  landing at *exactly* the `minFrequency` boundary regardless of the actual
  noise frequency.

**Fix.** Three layered changes:

1. Raised guitar's `minFrequency` from 60 → 70 Hz — clear of the 50/60 Hz
   mains-hum band, with margin.
2. Added a real 2-stage high-pass Biquad filter to the live audio graph
   (`highpass1`/`highpass2` in `startListening()`, each cutoff set to
   `config.minFrequency`), attenuating sub-range energy *before* it reaches
   the analyser — not just excluding it from the reported range after the
   fact.
3. Added a **boundary-artifact guard**: any detection landing within 3% of
   the exact `minFrequency` floor is rejected outright, regardless of its
   clarity score, since genuine notes land meaningfully above the floor at
   their real frequency while this specific failure mode always clamps to
   the boundary itself.

```js
const isBoundaryArtifact = result && result.frequency < config.minFrequency * 1.03;
```

**Verification.** The original repro case (weak E4 + strong low-frequency
noise, even at an extreme 10:1 noise-to-signal ratio) now correctly shows
nothing rather than a false "C2." Re-verified that every tuning preset's
lowest legitimate string (73.42–82.41 Hz) still detects correctly with the
raised floor and the new filter in place.

---

## 5. Octave-down error: flickering between a note and its subharmonic

**Symptom.** Guitar's E4 string intermittently flickered between reading
correctly (E4) and reading as E3 — exactly half its frequency — with the
E3 reading not matching any string in standard tuning, so it also flashed
"Not part of this tuning."

**Diagnosis.** The reverse of §1: instead of overshooting to a *shorter*
period (a harmonic), the search occasionally settles on *double* the true
period. Any periodic signal with true period T trivially also "repeats" at
2T, so if the fundamental's own dip at T doesn't clear threshold as cleanly
as expected, the walk can continue to the deeper, cleaner-looking dip at 2T
instead.

**Fix.** Deliberately **not** fixed at the detector level — unconditionally
preferring a shorter candidate period would risk misreading a genuinely low
note as its own real 2nd harmonic (reintroducing §1 from the other
direction). Instead, fixed at the *matching* level in `app.js`, where the
app has domain knowledge §1 doesn't: the specific, finite set of valid
target pitches for the current tuning.

```js
function correctOctaveDownError(freq) {
  if (!activeTuning) return freq;
  const raw = findClosestTuningMatch(freq);
  const doubled = findClosestTuningMatch(freq * 2);
  if (doubled.closestCents < 50 && doubled.closestCents < raw.closestCents - 100) {
    return freq * 2; // (see §6 for the guard added here)
  }
  return freq;
}
```

If doubling a poorly-matching reading suddenly lands it almost exactly (< 50
cents) on a real tuning target, and the raw reading wasn't close to
*anything* (> 100 cents worse), that's treated as strong evidence of this
specific error and corrected before the value ever reaches the smoothing
filter.

**Verification.** Feeding a raw 164.81 Hz tone (exactly E4 ÷ 2) directly
into the app now correctly resolves to a stable "E4 / 1st String — High E"
reading instead of flickering. A genuine, unrelated D3 reading (146.83 Hz,
an actual tuning target) was confirmed unaffected — the correction doesn't
fire when the raw reading already matches something.

---

## 6. Regression: the octave-down fix broke a mathematically ambiguous case

**Symptom.** After §5 shipped, guitar's *low* E string (E2) started
intermittently misreporting as E4.

**Diagnosis.** E2 (82.41 Hz) and E4 (329.63 Hz) are *exactly* two octaves
apart in standard tuning — both are "E." That means E2's own 2nd harmonic
(164.82 Hz) and E4's octave-down error (329.63 ÷ 2 = 164.815 Hz) are the
same frequency, to within rounding. When E2's fundamental occasionally
underperformed and the detector reported its 2nd harmonic instead (a
pre-existing, independent risk — see §1), §5's correction took that
already-wrong 164.8 Hz reading and "helpfully" doubled it straight into a
false E4 match. The fix from §5 had no way to distinguish "this is E4 read
an octave low" from "this is E2 read an octave high" — both produce the
identical input.

**Fix.** Added an explicit ambiguity guard: before applying the §5
correction, check whether the *same* frequency is also explainable as some
other target's own 2nd harmonic (i.e., whether *halving* it lands on a
different target than doubling it does). If so, the correction is
genuinely ambiguous and is skipped — surfacing the honest "not part of this
tuning" fallback instead of confidently guessing wrong.

```js
const halved = findClosestTuningMatch(freq / 2);
const isAmbiguous = halved.closestCents < 50 && halved.closestIndex !== doubled.closestIndex;
if (!isAmbiguous) return freq * 2;
```

**Verification.** The exact 164.82 Hz ambiguous case no longer resolves to
E4 (falls back to the pre-§5 "E3 / not part of this tuning" behavior, which
is honest rather than wrong). Genuine E2 and genuine E4 readings both
continue to work normally. A separate, *non*-ambiguous octave-down case
(half of B3, which doesn't coincide with any other target's harmonic) was
confirmed to still get corrected — the guard only suppresses the
specifically ambiguous cases, not the mechanism generally.

---

## 7. Real strings still failed even on a firm pluck

**Symptom.** After §1–§6, guitar's E4 still frequently showed nothing at
all — confirmed via direct questioning to be a real rejection, not a
display issue (the input-level meter moved normally, and playing harder
made no difference).

**Diagnosis.** No single further synthetic model could be found where the
existing thresholds failed, suggesting the gap was between what synthetic
models can represent and what a real, physically complex instrument
actually produces — not a specific isolable bug.

**Fix.** Loosened guitar's core detection thresholds substantially:
`threshold` 0.15 → 0.25, `clarityThreshold` 0.8 → 0.55. This is a
deliberately large loosening, justified by the fact that false-positive
protection no longer rests on these two numbers alone — §4's boundary
guard and §1's frequency-range capping now carry that load independently.

**Verification.** Re-confirmed zero false positives against pure noise at
the loosened settings (0/80 trials), and re-confirmed §4's noise-lock
repro case still correctly rejects rather than producing a false reading.

---

## 8. Piano's highest octave: the same weak-fundamental problem, worse

**Symptom.** Piano keys in the C7 octave and above showed nothing.

**Diagnosis.** A well-documented property of real pianos: string stiffness
causes *inharmonicity*, which becomes severe toward the top of the
instrument — the fundamental can become almost acoustically absent, with
perceived pitch coming mostly from the pattern of upper partials. Piano's
`clarityThreshold` had never been touched since the app's original design
(`0.9` — far stricter than any other instrument). A synthetic weak-
fundamental C7 profile scored clarity **0.893**, just under that 0.9 gate.

**Fix.** Loosened piano's `threshold` 0.15 → 0.2 and `clarityThreshold`
0.9 → 0.7 — more conservative than guitar's §7 loosening, since piano's
frequency range (25–4500 Hz) is far wider and warrants more caution.

**Verification.** The same weak-fundamental C7 profile, run through the
full real audio pipeline (not just the raw detector), now correctly
resolves to "C, octave 7."

---

## 9. First attempt at extending the fix: a hard frequency cutoff (later found flawed)

**Symptom.** Following §8, C7 through roughly E7 worked, but F7 and above
still failed.

**Diagnosis (at the time).** Assumed inharmonicity became severe enough,
specifically above some frequency, that even `clarityThreshold: 0.7` was
too strict.

**Fix (later superseded — see §10).** Added a two-tier system: above a
`highFreqThreshold` of 2500 Hz, apply a much looser
`highFreqClarityThreshold` of 0.4.

This is documented here because the *reasoning that invalidated it* is
itself instructive — see the next entry.

---

## 10. The two-tier cutoff left a real gap, and got reports of *worse* behavior

**Symptom.** After §9 shipped, the reported failure boundary didn't
improve — if anything it looked worse ("keys after C♯7 do not show
anything").

**Diagnosis.** D7 and D♯7 (2349.32 Hz and 2489.02 Hz) sit *just below* the
2500 Hz cutoff chosen in §9. They received **zero** benefit from the
loosened threshold — still gated at the strict 0.7 — while the framing of
"C7–E7 good, F7+ bad" had never actually been verified key-by-key, so this
gap had likely been present (and unreported) all along. The deeper problem
wasn't the specific cutoff value; it was modeling piano inharmonicity as a
sharp step function at all, when the real phenomenon is a **gradual**
effect across the whole upper register.

**Fix.** Replaced the two-tier system with a continuous linear gradient,
computed per-detection rather than gated at one fixed frequency:

```js
function requiredClarityFor(frequency) {
  const gradient = config.clarityGradient;
  if (!gradient) return config.clarityThreshold;
  const { startFreq, endFreq, startClarity, endClarity } = gradient;
  if (frequency <= startFreq) return startClarity;
  if (frequency >= endFreq) return endClarity;
  const t = (frequency - startFreq) / (endFreq - startFreq);
  return startClarity + t * (endClarity - startClarity);
}
```

Piano's gradient relaxes from `0.7` at `1000 Hz` down to `0.35` at
`4500 Hz`, so every note above roughly C6 gets *some* proportional benefit,
with no discontinuity for a later report to fall into.

**Verification.** Re-derived the required-clarity value across the whole
D7–C8 range and confirmed no more gaps (previously-stuck D7/D♯7 now
receive ~0.56 instead of the flat 0.7). Re-tested broadband high-frequency
noise across the *entire* gradient (100 trials) with zero false positives,
confirming the wider relaxation doesn't trade away noise robustness.

---

## 11. Open issue: piano's D7 and above, unresolved

**Symptom.** After §10, the reported failure boundary ("D7 and above show
nothing") had **not moved at all** compared to before the gradient fix,
despite three successive rounds of clarity-threshold loosening
(0.9 → 0.7 → a gradient reaching down to 0.35).

**Diagnosis attempted.** A clarity threshold governs whether an
*already-found* candidate is accepted — if loosening it repeatedly produces
no change, the more likely explanation is that the search is failing to
find a candidate **at all** (governed by the separate YIN `threshold`
parameter, which gates the search itself and had not been touched since
§8). Two diagnostic questions ruled out simpler explanations: the input
level meter moved normally (not a capture/volume issue), and playing
louder made no difference (not a marginal SNR issue — pointing to
something structural rather than a borderline signal).

From there, several hypotheses were tested and **none held up**:

- A hypothesis that D7 (2349.32 Hz) sitting just above
  `maxFrequency / 2 = 2250 Hz` was significant (notes below that line keep
  their own 2nd harmonic in-range as a possible "fallback" candidate;
  notes above it don't) — a Monte Carlo comparison of C♯7 vs. D7 across 200
  randomized parameter combinations each showed a real but modest
  difference (108/200 vs. 130/200 "correct" outcomes), not the sharp,
  reproducible cliff the reports described.
- Repeated attempts, including deliberately extreme and somewhat
  unrealistic parameter sweeps, to get the raw detector to return a true
  null result (no candidate found at all) for D7 — every attempt still
  found *some* candidate, meaning the synthetic model could not reproduce
  whatever the real signal was actually doing.
- Running the same weak-fundamental D7 profile through the complete real
  audio pipeline (not just the raw detector in isolation) — it detected
  correctly, again failing to reproduce the reported failure.

**Status.** Left open. Every synthetic reproduction attempt this session
either passed cleanly or broke unpredictably across *multiple* unrelated
notes — never the sharp, repeatable D7 boundary reported. That mismatch
between synthetic modeling and real-world behavior is itself the most
useful data point: it means whatever is actually happening on the real
piano being tested has some property (in the noise floor, the actual
inharmonicity curve, the mic's frequency response, or something else
entirely) that this session's synthetic models never captured. Documented
honestly rather than claiming a fix that was never actually confirmed.

---

## Summary: what generalized, what didn't

- **Frequency-range capping** (§1) and the **boundary-artifact guard**
  (§4) are structural — they apply automatically to every instrument via
  shared code in `app.js`, driven entirely by each instrument's
  `minFrequency`/`maxFrequency` in `instruments.js`. Verified to correctly
  protect bass, ukulele, violin, and viola against the same failure modes
  guitar and piano surfaced first, without instrument-specific code.
- **The octave-down correction and its ambiguity guard** (§5, §6) are also
  fully generic, driven by whatever `activeTuning` is currently selected —
  verified to correctly handle bass's analogous G1/G2 case using the same
  logic written for guitar's E2/E4.
- **Threshold, clarity, and gradient values**, by contrast, are
  necessarily per-instrument and were tuned empirically against real
  reports, not derived from a formula. They're the least "solved" part of
  this system — §11 is a reminder that empirical tuning against synthetic
  models has real limits when the synthetic models don't match reality
  closely enough.
