export const WORLD = Object.freeze({ width: 960, height: 600 });

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(seed = 2026) {
  return {
    seed,
    random: mulberry32(seed),
    mode: "ready",
    elapsed: 0,
    score: 0,
    energy: 100,
    combo: 0,
    bestCombo: 0,
    level: 1,
    flash: 0,
    shake: 0,
    nextHazard: 0.7,
    nextPulse: 1.15,
    player: { x: WORLD.width / 2, y: WORLD.height - 84, vx: 0, radius: 17 },
    hazards: [],
    pulses: []
  };
}

export function startGame(state) {
  if (state.mode === "ready") state.mode = "running";
  return state;
}

export function togglePause(state) {
  if (state.mode === "running") state.mode = "paused";
  else if (state.mode === "paused") state.mode = "running";
  return state;
}

export function resetGame(state) {
  return createGame(state.seed + 1);
}

export function addHazard(state, values = {}) {
  state.hazards.push({
    x: values.x ?? 70 + state.random() * (WORLD.width - 140),
    y: values.y ?? -30,
    radius: values.radius ?? 18 + state.random() * 12,
    speed: values.speed ?? 180 + state.level * 24 + state.random() * 90,
    spin: values.spin ?? (state.random() - 0.5) * 4,
    angle: values.angle ?? 0
  });
}

export function addPulse(state, values = {}) {
  state.pulses.push({
    x: values.x ?? 60 + state.random() * (WORLD.width - 120),
    y: values.y ?? -24,
    radius: values.radius ?? 12,
    speed: values.speed ?? 145 + state.level * 10,
    phase: values.phase ?? state.random() * Math.PI * 2
  });
}

function collides(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius;
}

export function stepGame(state, input = {}, dt = 1 / 60) {
  if (state.mode !== "running") return state;
  const frame = Math.min(Math.max(dt, 0), 0.05);
  state.elapsed += frame;
  state.level = 1 + Math.floor(state.elapsed / 14);
  state.score += frame * (18 + state.level * 2 + state.combo * 3);
  state.energy = Math.max(0, state.energy - frame * (1.2 + state.level * 0.08));
  state.flash = Math.max(0, state.flash - frame * 3.5);
  state.shake = Math.max(0, state.shake - frame * 4);

  const direction = Math.max(-1, Math.min(1, Number(input.direction) || 0));
  if (Number.isFinite(input.pointerX)) {
    const delta = input.pointerX - state.player.x;
    state.player.vx += Math.max(-1, Math.min(1, delta / 80)) * 1900 * frame;
  } else {
    state.player.vx += direction * 2100 * frame;
  }
  state.player.vx *= Math.pow(0.0008, frame);
  state.player.vx = Math.max(-480, Math.min(480, state.player.vx));
  state.player.x += state.player.vx * frame;
  state.player.x = Math.max(34, Math.min(WORLD.width - 34, state.player.x));

  state.nextHazard -= frame;
  state.nextPulse -= frame;
  if (state.nextHazard <= 0) {
    addHazard(state);
    state.nextHazard = Math.max(0.3, 0.86 - state.level * 0.045) * (0.75 + state.random() * 0.5);
  }
  if (state.nextPulse <= 0) {
    addPulse(state);
    state.nextPulse = 1.35 + state.random() * 1.15;
  }

  for (const hazard of state.hazards) {
    hazard.y += hazard.speed * frame;
    hazard.angle += hazard.spin * frame;
  }
  for (const pulse of state.pulses) {
    pulse.y += pulse.speed * frame;
    pulse.phase += frame * 5;
  }

  for (let index = state.hazards.length - 1; index >= 0; index -= 1) {
    const hazard = state.hazards[index];
    if (collides(state.player, hazard)) {
      state.hazards.splice(index, 1);
      state.energy = Math.max(0, state.energy - 36);
      state.combo = 0;
      state.flash = 1;
      state.shake = 1;
    } else if (hazard.y - hazard.radius > WORLD.height) {
      state.hazards.splice(index, 1);
      state.score += 8;
    }
  }

  for (let index = state.pulses.length - 1; index >= 0; index -= 1) {
    const pulse = state.pulses[index];
    if (collides(state.player, pulse)) {
      state.pulses.splice(index, 1);
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      state.energy = Math.min(100, state.energy + 13);
      state.score += 90 * state.combo;
    } else if (pulse.y - pulse.radius > WORLD.height) {
      state.pulses.splice(index, 1);
      state.combo = 0;
    }
  }

  if (state.energy <= 0) state.mode = "gameover";
  return state;
}

export function snapshot(state) {
  return {
    mode: state.mode,
    score: Math.floor(state.score),
    energy: Math.ceil(state.energy),
    combo: state.combo,
    bestCombo: state.bestCombo,
    level: state.level,
    playerX: Math.round(state.player.x)
  };
}
