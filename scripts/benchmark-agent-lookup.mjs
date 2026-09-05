import { performance } from 'node:perf_hooks';

export function runBenchmark() {
  const numAgents = 1000;
  const numSubtasks = 5000;

  const agents = Array.from({ length: numAgents }, (_, i) => ({
    id: `agent_${i}`,
    adapter: 'generic-cli',
  }));

  const subtasks = Array.from({ length: numSubtasks }, (_, i) => ({
    id: `subtask_${i}`,
    implementer: `agent_${i % numAgents}`,
  }));

  const busConfig = { agents };
  const implementers = [...new Set(subtasks.map(s => s.implementer))].sort();

  // Array.find (Baseline)
  const t0 = performance.now();
  for (let iter = 0; iter < 100; iter++) {
    for (const implementer of implementers) {
      const projectAgent = busConfig.agents.find(agent => agent.id === implementer);
    }
  }
  const baselineTime = performance.now() - t0;

  // Map.get (Optimized)
  const t2 = performance.now();
  for (let iter = 0; iter < 100; iter++) {
    const agentsById = new Map((busConfig.agents || []).map(agent => [agent.id, agent]));
    for (const implementer of implementers) {
      const projectAgent = agentsById.get(implementer);
    }
  }
  const optimizedTime = performance.now() - t2;

  console.log(`Baseline (Array.find): ${baselineTime.toFixed(3)} ms`);
  console.log(`Optimized (Map.get):   ${optimizedTime.toFixed(3)} ms`);
  console.log(`Speedup:               ${(baselineTime / optimizedTime).toFixed(2)}x`);

  return { baselineTime, optimizedTime };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmark();
}
