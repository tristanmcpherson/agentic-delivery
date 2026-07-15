import test from "node:test";
import assert from "node:assert/strict";
import { WORLD, addHazard, addPulse, createGame, snapshot, startGame, stepGame, togglePause } from "../game/engine.mjs";

test("deterministic seeded simulation", () => {
  const first = startGame(createGame(42));
  const second = startGame(createGame(42));
  for (let frame = 0; frame < 180; frame += 1) {
    stepGame(first, { direction: frame < 90 ? 1 : -1 }, 1 / 60);
    stepGame(second, { direction: frame < 90 ? 1 : -1 }, 1 / 60);
  }
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.deepEqual(first.hazards, second.hazards);
});

test("steering and bounds", () => {
  const state = startGame(createGame(5));
  const initialX = state.player.x;
  for (let frame = 0; frame < 45; frame += 1) stepGame(state, { direction: 1 }, 1 / 60);
  assert.ok(state.player.x > initialX + 100);
  for (let frame = 0; frame < 240; frame += 1) stepGame(state, { direction: 1 }, 1 / 60);
  assert.ok(state.player.x <= WORLD.width - 34);
});

test("pulse collection and combo", () => {
  const state = startGame(createGame(9));
  state.energy = 50;
  addPulse(state, { x: state.player.x, y: state.player.y, speed: 0 });
  stepGame(state, {}, 1 / 60);
  assert.equal(state.combo, 1);
  assert.equal(state.bestCombo, 1);
  assert.ok(state.score >= 90);
  assert.ok(state.energy > 60);
});

test("hazard collision and game over", () => {
  const state = startGame(createGame(11));
  state.energy = 30;
  addHazard(state, { x: state.player.x, y: state.player.y, speed: 0 });
  stepGame(state, {}, 1 / 60);
  assert.equal(state.mode, "gameover");
  assert.equal(state.energy, 0);
  assert.equal(state.combo, 0);
});

test("paused simulation", () => {
  const state = startGame(createGame(17));
  stepGame(state, { direction: 1 }, 1 / 60);
  togglePause(state);
  const before = snapshot(state);
  stepGame(state, { direction: 1 }, 1);
  assert.deepEqual(snapshot(state), before);
});
