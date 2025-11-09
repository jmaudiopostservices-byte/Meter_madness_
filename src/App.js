import React, { useEffect, useRef, useState } from "react";

// Helper math
const dBToLinear = (db) => Math.pow(10, db / 20);
const linearToDb = (lin) => 20 * Math.log10(Math.max(1e-12, lin));

export default function MeterMadness() {
  const [gainDb, setGainDb] = useState(-6);
  const [dynamics, setDynamics] = useState(0.6);
  const [running, setRunning] = useState(true);
  const [showWave, setShowWave] = useState(true);
  const [seed, setSeed] = useState(1);

  const rafRef = useRef(null);
  const lastTimeRef = useRef(null);

  const [vuValue, setVuValue] = useState(0);
  const [ppmValue, setPpmValue] = useState(0);
  const [peakValue, setPeakValue] = useState(0);
  const [lufsValue, setLufsValue] = useState(0);

  const lufsBufferRef = useRef([]);
  const ppmHoldRef = useRef(0);
  const ppmHoldTimerRef = useRef(0);
  const historyRef = useRef(new Array(200).fill(0));

  const seedRef = useRef(1);
  useEffect(() => {
    seedRef.current = seed;
  }, [seed]);

  function seededRandom() {
    seedRef.current = (seedRef.current * 1664525 + 1013904223) % 4294967296;
    return seedRef.current / 4294967296;
  }

  const VU_TAU = 0.3;
  const PPM_ATTACK = 0.01;
  const PPM_RELEASE = 0.08;
  const PEAK_ATTACK = 0.0005;
  const PEAK_RELEASE = 0.05;
  const LUFS_INTEGRATION = 3.0;

  useEffect(() => {
    lastTimeRef.current = performance.now();

    function step(now) {
      const dt = Math.max(0.001, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      if (running) {
        const base = dBToLinear(gainDb);
        const r = seededRandom();
        const spikeProb = 0.08 * dynamics;
        const isSpike = r < spikeProb;
        const spike = isSpike ? (0.6 + seededRandom() * 0.4) * dynamics : 0;
        const t = now / 1000 + seed * 0.1;
        const tone = 0.25 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t));
        const instantaneous = Math.min(
          1,
          base * (0.2 + tone + spike + 0.1 * seededRandom())
        );

        historyRef.current.push(instantaneous);
        if (historyRef.current.length > 200) historyRef.current.shift();

        const vuAlpha = 1 - Math.exp(-dt / VU_TAU);
        setVuValue((prev) => prev + vuAlpha * (instantaneous - prev));

        const peakAlphaAttack = 1 - Math.exp(-dt / PEAK_ATTACK);
        const peakAlphaRelease = 1 - Math.exp(-dt / PEAK_RELEASE);
        setPeakValue((prev) =>
          instantaneous > prev
            ? prev + peakAlphaAttack * (instantaneous - prev)
            : prev + peakAlphaRelease * (instantaneous - prev)
        );

        setPpmValue((prev) => {
          const attack = 1 - Math.exp(-dt / PPM_ATTACK);
          const release = 1 - Math.exp(-dt / PPM_RELEASE);
          let next =
            instantaneous > prev
              ? prev + attack * (instantaneous - prev)
              : prev + release * (instantaneous - prev);
          if (next > ppmHoldRef.current) {
            ppmHoldRef.current = next;
            ppmHoldTimerRef.current = 0.08;
          }
          ppmHoldTimerRef.current = Math.max(0, ppmHoldTimerRef.current - dt);
          if (ppmHoldTimerRef.current <= 0) {
            ppmHoldRef.current =
              ppmHoldRef.current + (prev - ppmHoldRef.current) * 0.3;
          }
          return next;
        });

        const instEnergy = instantaneous * instantaneous;
        lufsBufferRef.current.push({ energy: instEnergy, dt });
        let totalT = 0;
        for (let i = lufsBufferRef.current.length - 1; i >= 0; --i) {
          totalT += lufsBufferRef.current[i].dt;
          if (totalT > LUFS_INTEGRATION) {
            lufsBufferRef.current.splice(0, i);
            break;
          }
        }
        const sumEnergy = lufsBufferRef.current.reduce(
          (s, x) => s + x.energy * x.dt,
          0
        );
        const intRms = Math.sqrt(sumEnergy / Math.max(1e-6, totalT));
        setLufsValue(intRms);
      }

      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, gainDb, dynamics, seed]);

  const linearToMeter = (lin) => Math.max(0, Math.min(1, lin));

  function NeedleMeter({ value, label }) {
    const angle = -60 + 120 * linearToMeter(value);
    return (
      <div style={{ width: "150px", margin: "10px" }}>
        <div style={{ fontWeight: "bold" }}>{label}</div>
        <div
          style={{
            position: "relative",
            height: "60px",
            width: "120px",
            border: "1px solid #555",
            borderRadius: "4px",
            background: "#222",
          }}
        >
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              width: "2px",
              height: "50%",
              background: "#0f0",
              transformOrigin: "bottom center",
              transform: `rotate(${angle}deg) translateX(-50%)`,
            }}
          />
        </div>
        <div>{linearToDb(value).toFixed(2)} dB</div>
      </div>
    );
  }

  function BarMeter({ value, label }) {
    const pct = Math.round(100 * linearToMeter(value));
    return (
      <div style={{ width: "150px", margin: "10px" }}>
        <div style={{ fontWeight: "bold" }}>{label}</div>
        <div
          style={{
            background: "#333",
            width: "100%",
            height: "20px",
            borderRadius: "4px",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "limegreen",
              transition: "width 50ms linear",
            }}
          />
        </div>
        <div>{linearToDb(value).toFixed(2)} dB</div>
      </div>
    );
  }

  function Waveform({ data }) {
    const path = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * 100;
        const y = 50 - v * 45;
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
    return (
      <svg
        viewBox="0 0 100 100"
        style={{ width: "100%", height: "80px", background: "#111" }}
      >
        <path d={path} fill="none" stroke="#0af" strokeWidth="1" />
      </svg>
    );
  }

  return (
    <div style={{ padding: "20px", background: "#111", color: "#eee" }}>
      <h2>Meters Not Speakers — Meter Madness</h2>
      <div>
        <label>
          Gain: {gainDb} dB
          <input
            type="range"
            min={-24}
            max={12}
            step={0.5}
            value={gainDb}
            onChange={(e) => setGainDb(Number(e.target.value))}
          />
        </label>
        <label style={{ marginLeft: "20px" }}>
          Dynamics: {Math.round(dynamics * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={dynamics}
            onChange={(e) => setDynamics(Number(e.target.value))}
          />
        </label>
      </div>
      <div style={{ marginTop: "10px" }}>
        <button onClick={() => setRunning((r) => !r)}>
          {running ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => setSeed((s) => s + 1)}
          style={{ marginLeft: "10px" }}
        >
          New Signal
        </button>
        <label style={{ marginLeft: "10px" }}>
          <input
            type="checkbox"
            checked={showWave}
            onChange={() => setShowWave((s) => !s)}
          />
          Show waveform
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", marginTop: "20px" }}>
        <NeedleMeter value={vuValue} label="VU" />
        <BarMeter value={ppmValue} label="PPM" />
        <BarMeter value={peakValue} label="Peak" />
        <BarMeter value={lufsValue} label="LUFS" />
      </div>

      {showWave && <Waveform data={historyRef.current} />}
    </div>
  );
}
