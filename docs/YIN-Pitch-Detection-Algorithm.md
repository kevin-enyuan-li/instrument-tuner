# The YIN Pitch Detection Algorithm

This document explains the pitch detection algorithm implemented in
[`pitchDetector.js`](../js/pitchDetector.js) — YIN, from Alain de Cheveigné and
Hideki Kawahara's 2002 paper *"YIN, a fundamental frequency estimator for
speech and music"* (*Journal of the Acoustical Society of America*, 111(4)).
It's a time-domain algorithm: no FFT, just arithmetic over a raw audio
buffer, refined to sub-sample precision.

## The problem it solves

The obvious way to find the period of a signal is **autocorrelation**: shift
the signal by a lag τ, multiply it against the original, sum the result, and
look for the τ that produces the strongest match. That works, but it has two
well-known weaknesses:

- Autocorrelation has no fixed scale — the "match strength" at different τ
  isn't directly comparable, so picking the *right* peak (as opposed to a
  peak at some multiple of the true period) requires ad-hoc heuristics.
- It's prone to **octave errors**: a strong harmonic can produce a peak as
  good as or better than the true fundamental's.

YIN starts from a *difference* function instead of a correlation, then adds
three corrections — normalization, an absolute threshold, and parabolic
interpolation — that directly address these weaknesses. Each step below maps
to a specific block in `detectPitch()`.

## Step 1 — The difference function

For each candidate lag τ, measure how *different* the signal is from a copy
of itself shifted by τ samples:

```
d(τ) = Σ (x[i] − x[i+τ])²          for i = 0 .. N/2
```

This is the mirror image of autocorrelation: instead of hunting for a
correlation *peak*, YIN hunts for a difference *dip*. If τ equals the true
period, the shifted copy lines up almost exactly with the original and
`d(τ)` drops toward zero.

```js
for (let tau = 1; tau <= maxTau; tau++) {
  let sum = 0;
  for (let i = 0; i < halfBufferSize; i++) {
    const delta = buffer[i] - buffer[i + tau];
    sum += delta * delta;
  }
  ...
}
```

(`pitchDetector.js`, inside the main loop of `detectPitch()`)

## Step 2 — Cumulative mean normalized difference (CMND)

Raw `d(τ)` isn't directly usable: it's trivially `0` at `τ=0`, and its
overall scale depends on the signal's amplitude and tends to drift with τ.
There's no fixed number you could call "low enough to be periodic."

YIN fixes this by dividing `d(τ)` by the running average of every `d(j)`
seen so far:

```
cmnd(τ) = d(τ) · τ / Σ_{j=1}^{τ} d(j)
```

```js
runningSum += sum;
cmnd[tau] = runningSum === 0 ? 1 : (sum * tau) / runningSum;
```

By convention `cmnd(0) = 1`. This reshaping is the single biggest
contributor to YIN's accuracy over plain autocorrelation: genuine
periodicity now produces a dip of comparable, *proportional* depth
regardless of the signal's absolute amplitude, and the normalization itself
suppresses a good deal of the octave confusion that plagues raw
autocorrelation or a raw difference function.

## Step 3 — Absolute threshold: picking a candidate

A tempting shortcut is "take the global minimum of `cmnd`." That's fragile —
noise can produce a spuriously deep dip anywhere in the range. YIN instead
scans τ from **small to large** (i.e. high frequency to low) and takes the
**first** point where `cmnd` drops below a fixed absolute threshold, then
keeps walking forward while `cmnd` keeps falling, to settle on that dip's
local minimum rather than its leading edge:

```js
let tauEstimate = -1;
for (let tau = minTau; tau <= maxTau; tau++) {
  if (cmnd[tau] < this.threshold) {
    while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) {
      tau++;
    }
    tauEstimate = tau;
    break;
  }
}
if (tauEstimate === -1) return null;
```

Scanning small-τ-first is deliberate: since `cmnd(τ)` also dips (less
deeply, usually) at integer multiples of the true period, taking the
*first* acceptable dip biases the estimate toward the shortest plausible
period — normally the true fundamental, not some multiple of it.

`minTau`/`maxTau` come from the instrument's configured `minFrequency`/
`maxFrequency`, which bound which lags are even considered:

```js
const minTau = Math.max(2, Math.floor(this.sampleRate / this.maxFrequency));
const maxTau = Math.min(halfBufferSize - 1, Math.ceil(this.sampleRate / this.minFrequency));
```

## Step 4 — Parabolic interpolation: sub-sample precision

`tauEstimate` so far is a whole number of samples, which only gives
whole-Hz resolution — nowhere near good enough for a tuner. YIN fits a
parabola through the three `cmnd` points surrounding the chosen minimum and
solves for the vertex, landing *between* two integer sample lags:

```js
const s0 = cmnd[x0], s1 = cmnd[tauEstimate], s2 = cmnd[x2];
const denom = 2 * (2 * s1 - s2 - s0);
betterTau = denom !== 0 ? tauEstimate + (s2 - s0) / denom : tauEstimate;
```

This is what turns "somewhere around 440 Hz" into "440.02 Hz" — sub-cent
accuracy from a few extra multiplications, not a larger analysis window.

## Frequency and confidence

```js
const frequency = this.sampleRate / betterTau;
const clarity = 1 - cmnd[tauEstimate];
```

Frequency falls straight out of the refined lag. `clarity` is simply "how
deep was the accepted dip": `cmnd` near `0` means the signal matched itself
almost perfectly (strongly periodic, high confidence); `cmnd` near `1` means
essentially no self-similarity. This is the exact number every
`clarityThreshold` / `clarityGradient` check in `app.js` gates on before
accepting a reading.

## Known limitations, and how this app compensates

YIN is a strong general-purpose algorithm, but it has specific, well-known
failure modes. This codebase's `instruments.js`/`app.js` layer exists almost
entirely to work around them:

- **Octave-up errors (harmonic lock).** If a string's true fundamental
  produces a shallow dip — common on a thin, quietly-plucked high string —
  the small-τ-first scan can walk past it and lock onto a strong harmonic
  instead, since the harmonic's own dip is encountered *first*. Fixed by
  capping each instrument's `maxFrequency` just above its highest note, so
  a string's own 2nd harmonic is never even in the search range.
- **Octave-down errors.** The opposite failure: the scan occasionally
  settles on *double* the true period. Since this can't be safely corrected
  at the detector level (it would risk misreading a genuinely lower note as
  its own 2nd harmonic), it's corrected at the matching level in `app.js` —
  if doubling a poorly-matching reading suddenly lands it on a real tuning
  target, that's treated as strong evidence of this specific error.
- **Boundary-clamping artifacts.** Strong low-frequency noise (mains hum,
  desk rumble) outside the valid range can make the scan clamp to the very
  edge of `minTau`/`maxTau` rather than correctly finding nothing — and that
  clamped result can carry a deceptively high clarity score. `app.js`
  rejects any result landing suspiciously close to the frequency floor,
  regardless of its clarity.
- **Weak, inharmonic fundamentals.** Real strings (and especially the
  extreme high register of a real piano, where string stiffness makes the
  fundamental barely present at all) often produce a shallower dip than a
  clean synthetic tone would. Per-instrument `threshold`/`clarityThreshold`
  values — and, for piano, a `clarityGradient` that relaxes the confidence
  bar smoothly across the upper register — give real, imperfect signals
  enough room to register without opening the door to false positives from
  noise (which is inherently rarer at high frequencies than low).

For the detailed, blow-by-blow history of how each of these was actually
diagnosed and fixed — including exact reproduction numbers and one issue
left honestly unresolved — see
[Pitch-Detection-Debugging-Log.md](Pitch-Detection-Debugging-Log.md).

## Reference

de Cheveigné, A., & Kawahara, H. (2002). YIN, a fundamental frequency
estimator for speech and music. *The Journal of the Acoustical Society of
America*, 111(4), 1917–1930.
