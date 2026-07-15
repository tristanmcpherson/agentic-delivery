import fs from "node:fs/promises";
import path from "node:path";

export default class AgenticReporter {
  constructor() {
    this.collected = [];
    this.results = [];
  }

  onBegin(_config, suite) {
    this.collected = suite.allTests().map((test) => ({
      id: test.id,
      title: test.title,
      title_path: test.titlePath(),
      expected_status: test.expectedStatus,
      location: test.location
    }));
  }

  onTestEnd(test, result) {
    this.results.push({
      id: test.id,
      title: test.title,
      title_path: test.titlePath(),
      expected_status: test.expectedStatus,
      status: result.status,
      retry: result.retry,
      duration_ms: result.duration,
      annotations: test.annotations
    });
  }

  async onEnd(result) {
    const output = process.env.AGENTIC_TEST_MANIFEST;
    if (!output) return;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify({
      schema_version: 1,
      overall_status: result.status,
      collected: this.collected,
      results: this.results
    }, null, 2)}\n`, "utf8");
  }
}
