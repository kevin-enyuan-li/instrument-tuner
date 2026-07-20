/**
 * YIN pitch detection algorithm (de Cheveigné & Kawahara, 2002).
 * Operates on a time-domain buffer and returns the fundamental frequency
 * with sub-sample precision via parabolic interpolation, plus a clarity
 * score (0-1) indicating how confident the estimate is.
 */
class PitchDetector {
  constructor(sampleRate, options = {}) {
    this.sampleRate = sampleRate;
    this.threshold = options.threshold ?? 0.15;
    this.minFrequency = options.minFrequency ?? 25;
    this.maxFrequency = options.maxFrequency ?? 4500;
  }

  detectPitch(buffer) {
    const bufferSize = buffer.length;
    const halfBufferSize = Math.floor(bufferSize / 2);

    const minTau = Math.max(2, Math.floor(this.sampleRate / this.maxFrequency));
    const maxTau = Math.min(halfBufferSize - 1, Math.ceil(this.sampleRate / this.minFrequency));
    if (maxTau <= minTau) return null;

    // Steps 1+2: difference function and cumulative mean normalized difference
    // function (CMNDF), combined into one pass. The running sum must start at
    // tau=1 (not minTau) so the normalization stays correct even though we only
    // search for a pitch candidate within [minTau, maxTau].
    const cmnd = new Float32Array(maxTau + 1);
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let i = 0; i < halfBufferSize; i++) {
        const delta = buffer[i] - buffer[i + tau];
        sum += delta * delta;
      }
      runningSum += sum;
      cmnd[tau] = runningSum === 0 ? 1 : (sum * tau) / runningSum;
    }

    // Step 3: absolute threshold — first local minimum below threshold,
    // restricted to the plausible frequency range to avoid picking up
    // sub-harmonics or high-frequency noise.
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

    // Step 4: parabolic interpolation around the minimum for sub-sample tau,
    // which translates directly into sub-cent frequency precision.
    const x0 = tauEstimate > minTau ? tauEstimate - 1 : tauEstimate;
    const x2 = tauEstimate < maxTau ? tauEstimate + 1 : tauEstimate;

    let betterTau;
    if (x0 === tauEstimate) {
      betterTau = cmnd[tauEstimate] <= cmnd[x2] ? tauEstimate : x2;
    } else if (x2 === tauEstimate) {
      betterTau = cmnd[tauEstimate] <= cmnd[x0] ? tauEstimate : x0;
    } else {
      const s0 = cmnd[x0];
      const s1 = cmnd[tauEstimate];
      const s2 = cmnd[x2];
      const denom = 2 * (2 * s1 - s2 - s0);
      betterTau = denom !== 0 ? tauEstimate + (s2 - s0) / denom : tauEstimate;
    }

    const frequency = this.sampleRate / betterTau;
    const clarity = 1 - cmnd[tauEstimate];

    return { frequency, clarity };
  }
}
