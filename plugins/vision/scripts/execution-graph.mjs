const GRAPH_SCHEMA_VERSION = 1;
const MAX_GRAPH_NODES = 24;
const EXECUTORS = new Set([
  "primary",
  "agentic-builder",
  "agentic-gap-reviewer",
  "agentic-builder-reviewer",
  "deterministic-code",
]);
const KINDS = new Set(["work", "review", "reduce"]);
const ISOLATIONS = new Set(["read-only", "shared", "worktree"]);
const REVIEW_EXECUTORS = new Set(["agentic-gap-reviewer", "agentic-builder-reviewer"]);
const ARTIFACT_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function stringArray(value, label, errors, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must be an array of non-empty strings`);
    return [];
  }
  if (!allowEmpty && value.length === 0) errors.push(`${label} must not be empty`);
  if (new Set(value).size !== value.length) errors.push(`${label} must not contain duplicates`);
  return value;
}

function graphLabel(message) {
  return `execution_graph ${message}`;
}

function graphMaps(graph) {
  const nodes = new Map((graph?.nodes || []).filter((node) => node?.id).map((node) => [node.id, node]));
  const incoming = new Map([...nodes.keys()].map((id) => [id, []]));
  const outgoing = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of graph?.edges || []) {
    if (incoming.has(edge?.to)) incoming.get(edge.to).push(edge);
    if (outgoing.has(edge?.from)) outgoing.get(edge.from).push(edge);
  }
  return { nodes, incoming, outgoing };
}

function cycleNodes(graph) {
  const { nodes, incoming, outgoing } = graphMaps(graph);
  const indegree = new Map([...nodes.keys()].map((id) => [id, incoming.get(id).length]));
  const queue = [...nodes.keys()].filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const edge of outgoing.get(id)) {
      indegree.set(edge.to, indegree.get(edge.to) - 1);
      if (indegree.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  return visited === nodes.size ? [] : [...indegree.entries()].filter(([, degree]) => degree > 0).map(([id]) => id);
}

export function validateExecutionGraph(graph, options = {}) {
  const errors = [];
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return [graphLabel("must be an object")];
  if (graph.schema_version !== GRAPH_SCHEMA_VERSION) errors.push(graphLabel(`schema_version must be ${GRAPH_SCHEMA_VERSION}`));
  const maximumParallel = Number(options.maxParallel ?? 3);
  if (!Number.isInteger(graph.max_parallel) || graph.max_parallel < 1 || graph.max_parallel > 3) {
    errors.push(graphLabel("max_parallel must be an integer from 1 to 3"));
  } else if (graph.max_parallel > maximumParallel) {
    errors.push(graphLabel(`max_parallel exceeds configured orchestration maximum ${maximumParallel}`));
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) errors.push(graphLabel("nodes must contain at least one node"));
  if (Array.isArray(graph.nodes) && graph.nodes.length > MAX_GRAPH_NODES) errors.push(graphLabel(`nodes must not exceed ${MAX_GRAPH_NODES}`));
  if (!Array.isArray(graph.edges)) errors.push(graphLabel("edges must be an array"));

  const acceptanceIds = new Set(options.acceptanceIds || []);
  const coveredCriteria = new Set();
  const nodes = new Map();
  for (const node of Array.isArray(graph.nodes) ? graph.nodes : []) {
    const id = typeof node?.id === "string" ? node.id.trim() : "";
    if (!id) errors.push(graphLabel("every node requires an id"));
    else if (nodes.has(id)) errors.push(graphLabel(`has duplicate node ${id}`));
    else nodes.set(id, node);
    const label = graphLabel(`node ${id || "<unknown>"}`);
    if (!KINDS.has(node?.kind)) errors.push(`${label} kind must be work, review, or reduce`);
    if (!EXECUTORS.has(node?.executor)) errors.push(`${label} executor is unsupported and cannot claim verifier or delivery authority`);
    if (typeof node?.description !== "string" || !node.description.trim()) errors.push(`${label} requires a description`);
    if (!ISOLATIONS.has(node?.isolation)) errors.push(`${label} isolation must be read-only, shared, or worktree`);
    const criteria = stringArray(node?.criterion_ids, `${label} criterion_ids`, errors);
    for (const criterionId of criteria) {
      if (acceptanceIds.size && !acceptanceIds.has(criterionId)) errors.push(`${label} references unknown criterion ${criterionId}`);
      else coveredCriteria.add(criterionId);
    }
    const inputs = stringArray(node?.inputs, `${label} inputs`, errors, { allowEmpty: true });
    const outputs = stringArray(node?.outputs, `${label} outputs`, errors);
    const writeScope = stringArray(node?.write_scope, `${label} write_scope`, errors, { allowEmpty: true });
    if (REVIEW_EXECUTORS.has(node?.executor)) {
      if (node.kind !== "review") errors.push(`${label} reviewer executor requires kind=review`);
      if (node.isolation !== "read-only" || writeScope.length) errors.push(`${label} reviewer must remain read-only with an empty write_scope`);
    }
    if (node?.executor === "agentic-builder") {
      if (node.kind !== "work") errors.push(`${label} builder executor requires kind=work`);
      if (!new Set(["shared", "worktree"]).has(node.isolation) || writeScope.length === 0) errors.push(`${label} builder requires shared or worktree isolation and explicit write_scope`);
    }
    if (node?.executor === "deterministic-code") {
      if (node.kind !== "reduce") errors.push(`${label} deterministic-code executor requires kind=reduce`);
      if (node.isolation !== "read-only" || writeScope.length) errors.push(`${label} deterministic-code must be read-only with an empty write_scope`);
    }
    if (node?.isolation === "read-only" && writeScope.length) errors.push(`${label} read-only isolation requires an empty write_scope`);
    if (["shared", "worktree"].includes(node?.isolation) && writeScope.length === 0) errors.push(`${label} writable isolation requires explicit write_scope`);
    if (inputs.some((input) => input.startsWith("contract:") && input.length === "contract:".length)) errors.push(`${label} has an empty contract input`);
    if (outputs.some((output) => output.startsWith("contract:"))) errors.push(`${label} outputs must be node artifacts, not contract inputs`);
  }

  const edgeKeys = new Set();
  const suppliedInputs = new Map();
  const producedArtifactTypes = new Map();
  for (const edge of Array.isArray(graph.edges) ? graph.edges : []) {
    const from = typeof edge?.from === "string" ? edge.from.trim() : "";
    const to = typeof edge?.to === "string" ? edge.to.trim() : "";
    const artifact = typeof edge?.artifact === "string" ? edge.artifact.trim() : "";
    const artifactType = typeof edge?.artifact_type === "string" ? edge.artifact_type.trim() : "";
    const label = graphLabel(`edge ${from || "<unknown>"}->${to || "<unknown>"}`);
    if (!from || !nodes.has(from)) errors.push(`${label} references unknown source node`);
    if (!to || !nodes.has(to)) errors.push(`${label} references unknown target node`);
    if (from && to && from === to) errors.push(`${label} cannot target itself`);
    if (!artifact) errors.push(`${label} requires an artifact`);
    if (!ARTIFACT_TYPE_PATTERN.test(artifactType)) errors.push(`${label} artifact_type must be a lowercase kebab-case type`);
    const key = `${from}\u0000${to}\u0000${artifact}`;
    if (edgeKeys.has(key)) errors.push(`${label} duplicates artifact ${artifact || "<missing>"}`);
    edgeKeys.add(key);
    if (nodes.get(from) && artifact && !nodes.get(from).outputs?.includes(artifact)) errors.push(`${label} artifact ${artifact} is not declared by source outputs`);
    if (nodes.get(to) && artifact && !nodes.get(to).inputs?.includes(artifact)) errors.push(`${label} artifact ${artifact} is not declared by target inputs`);
    if (from && artifact && artifactType) {
      const producedKey = `${from}\u0000${artifact}`;
      const priorType = producedArtifactTypes.get(producedKey);
      if (priorType && priorType !== artifactType) errors.push(`${label} artifact ${artifact} conflicts with producer type ${priorType}`);
      else producedArtifactTypes.set(producedKey, artifactType);
    }
    if (to && artifact) {
      const inputKey = `${to}\u0000${artifact}`;
      suppliedInputs.set(inputKey, (suppliedInputs.get(inputKey) || 0) + 1);
    }
  }
  for (const [id, node] of nodes) {
    for (const input of node.inputs || []) {
      if (input.startsWith("contract:")) continue;
      const count = suppliedInputs.get(`${id}\u0000${input}`) || 0;
      if (count !== 1) errors.push(graphLabel(`node ${id} input ${input} must be supplied by exactly one edge`));
    }
  }
  for (const criterionId of acceptanceIds) if (!coveredCriteria.has(criterionId)) errors.push(graphLabel(`does not cover acceptance criterion ${criterionId}`));
  const cyclicNodeIds = nodes.size ? cycleNodes(graph) : [];
  if (cyclicNodeIds.length) errors.push(graphLabel(`must be acyclic; cycle includes ${cyclicNodeIds.join(", ")}`));

  const convergence = graph.convergence;
  if (!convergence || typeof convergence !== "object" || Array.isArray(convergence)) errors.push(graphLabel("convergence policy is required"));
  if (!Number.isInteger(convergence?.max_repair_rounds) || convergence.max_repair_rounds < 0 || convergence.max_repair_rounds > 3) errors.push(graphLabel("convergence.max_repair_rounds must be an integer from 0 to 3"));
  if (!Number.isInteger(convergence?.no_progress_limit) || convergence.no_progress_limit < 1 || convergence.no_progress_limit > 2) errors.push(graphLabel("convergence.no_progress_limit must be an integer from 1 to 2"));
  if (convergence?.dedupe_scope !== "all-seen") errors.push(graphLabel("convergence.dedupe_scope must be all-seen"));
  if (convergence?.required_failure !== "block") errors.push(graphLabel("convergence.required_failure must be block; required node failures cannot be filtered out"));
  return errors;
}

function parallelSafe(node) {
  return node.isolation === "read-only" || node.isolation === "worktree";
}

function assertCompletedClosure(graph, completedNodeIds) {
  const { nodes, incoming } = graphMaps(graph);
  const completed = new Set(completedNodeIds);
  for (const id of completed) if (!nodes.has(id)) throw new Error(`Unknown completed execution-graph node: ${id}`);
  for (const id of completed) {
    for (const edge of incoming.get(id)) {
      if (!completed.has(edge.from)) throw new Error(`Completed execution-graph node ${id} is missing completed dependency ${edge.from}`);
    }
  }
  return completed;
}

export function buildExecutionPlan(graph, options = {}) {
  const validation = validateExecutionGraph(graph, options);
  if (validation.length) throw new Error(validation.join("\n"));
  const { nodes, incoming, outgoing } = graphMaps(graph);
  const completed = assertCompletedClosure(graph, options.completedNodeIds || []);
  const planned = new Set(completed);
  const waves = [];
  while (planned.size < nodes.size) {
    const ready = [...nodes.values()].filter((node) => !planned.has(node.id) && incoming.get(node.id).every((edge) => planned.has(edge.from)));
    if (!ready.length) throw new Error("Execution graph has no schedulable node; check dependencies.");
    const safe = ready.filter(parallelSafe);
    const selected = (safe.length ? safe.slice(0, graph.max_parallel) : [ready[0]]);
    const before = new Set(planned);
    for (const node of selected) planned.add(node.id);
    const newlyUnblockedFanIns = [...nodes.values()]
      .filter((node) => !planned.has(node.id) && incoming.get(node.id).length > 1)
      .filter((node) => incoming.get(node.id).every((edge) => planned.has(edge.from)) && !incoming.get(node.id).every((edge) => before.has(edge.from)))
      .map((node) => node.id);
    waves.push({
      index: waves.length + 1,
      parallel: selected.length > 1,
      reason: selected.length > 1 ? "independent nodes with read-only or worktree isolation" : parallelSafe(selected[0]) ? "single ready node" : "shared-workspace writer serialized",
      node_ids: selected.map((node) => node.id),
      nodes: selected.map((node) => ({
        id: node.id,
        kind: node.kind,
        executor: node.executor,
        description: node.description,
        criterion_ids: node.criterion_ids,
        inputs: node.inputs,
        outputs: node.outputs,
        isolation: node.isolation,
        write_scope: node.write_scope,
        input_handoffs: incoming.get(node.id).map((edge) => ({
          from: edge.from,
          artifact: edge.artifact,
          artifact_type: edge.artifact_type,
        })),
        output_handoffs: outgoing.get(node.id).map((edge) => ({
          to: edge.to,
          artifact: edge.artifact,
          artifact_type: edge.artifact_type,
        })),
      })),
      unblocks_fan_in: newlyUnblockedFanIns,
    });
  }
  const remaining = [...nodes.keys()].filter((id) => !completed.has(id));
  const terminalNodeIds = [...nodes.keys()].filter((id) => outgoing.get(id).length === 0);
  return {
    complete: remaining.length === 0,
    completed_node_ids: [...completed],
    remaining_node_ids: remaining,
    terminal_node_ids: terminalNodeIds,
    next_wave: waves[0] || null,
    waves,
  };
}
