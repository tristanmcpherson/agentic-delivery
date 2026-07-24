import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionPlan, validateExecutionGraph } from "../plugins/vision/scripts/execution-graph.mjs";

function graph() {
  return {
    schema_version: 1,
    max_parallel: 2,
    nodes: [
      {
        id: "service-slice",
        kind: "work",
        executor: "agentic-builder",
        description: "Implement the service slice.",
        criterion_ids: ["AC-1"],
        inputs: ["contract:AC-1"],
        outputs: ["service-candidate"],
        isolation: "worktree",
        write_scope: ["src/service"],
      },
      {
        id: "ui-slice",
        kind: "work",
        executor: "agentic-builder",
        description: "Implement the UI slice.",
        criterion_ids: ["AC-1"],
        inputs: ["contract:AC-1"],
        outputs: ["ui-candidate"],
        isolation: "worktree",
        write_scope: ["src/ui"],
      },
      {
        id: "integrate",
        kind: "work",
        executor: "primary",
        description: "Integrate the independently produced candidates.",
        criterion_ids: ["AC-1"],
        inputs: ["service-candidate", "ui-candidate"],
        outputs: ["integrated-candidate"],
        isolation: "shared",
        write_scope: ["src"],
      },
    ],
    edges: [
      { from: "service-slice", to: "integrate", artifact: "service-candidate", artifact_type: "candidate" },
      { from: "ui-slice", to: "integrate", artifact: "ui-candidate", artifact_type: "candidate" },
    ],
    convergence: {
      max_repair_rounds: 2,
      no_progress_limit: 2,
      dedupe_scope: "all-seen",
      required_failure: "block",
    },
  };
}

const options = { acceptanceIds: ["AC-1"], maxParallel: 3 };

test("execution graph plans an isolated fan-out, barrier, and serialized integration", () => {
  const subject = graph();
  assert.deepEqual(validateExecutionGraph(subject, options), []);
  const plan = buildExecutionPlan(subject, options);
  assert.deepEqual(plan.waves.map((wave) => wave.node_ids), [
    ["service-slice", "ui-slice"],
    ["integrate"],
  ]);
  assert.equal(plan.waves[0].parallel, true);
  assert.deepEqual(plan.waves[0].unblocks_fan_in, ["integrate"]);
  assert.deepEqual(plan.waves[1].nodes[0].input_handoffs, [
    { from: "service-slice", artifact: "service-candidate", artifact_type: "candidate" },
    { from: "ui-slice", artifact: "ui-candidate", artifact_type: "candidate" },
  ]);
  assert.match(plan.waves[1].reason, /shared-workspace writer serialized/);
});

test("execution graph resume requires dependency-closed completed nodes", () => {
  const subject = graph();
  const resumed = buildExecutionPlan(subject, { ...options, completedNodeIds: ["service-slice", "ui-slice"] });
  assert.deepEqual(resumed.next_wave.node_ids, ["integrate"]);
  assert.throws(
    () => buildExecutionPlan(subject, { ...options, completedNodeIds: ["integrate"] }),
    /missing completed dependency service-slice/,
  );
});

test("shared-workspace writers are serialized even without data dependencies", () => {
  const subject = graph();
  subject.nodes = subject.nodes.slice(0, 2).map((node) => ({ ...node, isolation: "shared" }));
  subject.edges = [];
  const plan = buildExecutionPlan(subject, options);
  assert.deepEqual(plan.waves.map((wave) => wave.node_ids), [["service-slice"], ["ui-slice"]]);
  assert.ok(plan.waves.every((wave) => wave.parallel === false));
});

test("execution graph rejects fake handoffs, cycles, authority claims, and drop-on-failure convergence", () => {
  const fakeHandoff = graph();
  fakeHandoff.edges[0].artifact = "undeclared-artifact";
  let errors = validateExecutionGraph(fakeHandoff, options);
  assert.ok(errors.some((error) => error.includes("not declared by source outputs")));
  assert.ok(errors.some((error) => error.includes("must be supplied by exactly one edge")));

  const untypedHandoff = graph();
  delete untypedHandoff.edges[0].artifact_type;
  errors = validateExecutionGraph(untypedHandoff, options);
  assert.ok(errors.some((error) => error.includes("artifact_type must be")));

  const conflictingTypes = graph();
  conflictingTypes.nodes.push({
    id: "archive", kind: "reduce", executor: "deterministic-code", description: "Archive the candidate metadata.", criterion_ids: ["AC-1"],
    inputs: ["service-candidate"], outputs: ["archive-record"], isolation: "read-only", write_scope: [],
  });
  conflictingTypes.edges.push({ from: "service-slice", to: "archive", artifact: "service-candidate", artifact_type: "review" });
  errors = validateExecutionGraph(conflictingTypes, options);
  assert.ok(errors.some((error) => error.includes("conflicts with producer type candidate")));

  const cycle = graph();
  cycle.nodes = [
    {
      id: "a", kind: "reduce", executor: "deterministic-code", description: "Reduce B output.", criterion_ids: ["AC-1"],
      inputs: ["b-output"], outputs: ["a-output"], isolation: "read-only", write_scope: [],
    },
    {
      id: "b", kind: "reduce", executor: "deterministic-code", description: "Reduce A output.", criterion_ids: ["AC-1"],
      inputs: ["a-output"], outputs: ["b-output"], isolation: "read-only", write_scope: [],
    },
  ];
  cycle.edges = [
    { from: "a", to: "b", artifact: "a-output", artifact_type: "data" },
    { from: "b", to: "a", artifact: "b-output", artifact_type: "data" },
  ];
  errors = validateExecutionGraph(cycle, options);
  assert.ok(errors.some((error) => error.includes("must be acyclic")));

  const authority = graph();
  authority.nodes[2].executor = "protected-verifier";
  errors = validateExecutionGraph(authority, options);
  assert.ok(errors.some((error) => error.includes("cannot claim verifier or delivery authority")));

  const dropped = graph();
  dropped.convergence.required_failure = "drop";
  errors = validateExecutionGraph(dropped, options);
  assert.ok(errors.some((error) => error.includes("required node failures cannot be filtered out")));
});
