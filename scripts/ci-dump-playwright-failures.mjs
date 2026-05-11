// Read playwright-report/results.json and emit a compact JSON array of
// every non-passing test result. Stdout is consumed by the CI workflow's
// E2E failure summary step.
import { readFileSync } from "node:fs";

let json;
try {
  json = JSON.parse(readFileSync("playwright-report/results.json", "utf8"));
} catch (err) {
  console.error("failed to read playwright-report/results.json:", err.message);
  process.exit(0);
}

const out = [];
function walk(node) {
  for (const child of node.suites ?? []) walk(child);
  for (const spec of node.specs ?? []) {
    for (const t of spec.tests ?? []) {
      for (const res of t.results ?? []) {
        if (res.status === "passed") continue;
        out.push({
          title: spec.title,
          file: spec.file,
          status: res.status,
          duration: res.duration,
          errors: res.errors,
          stdout: (res.stdout ?? []).slice(0, 20),
          stderr: (res.stderr ?? []).slice(0, 20),
          attachments: (res.attachments ?? []).map((a) => ({
            name: a.name,
            contentType: a.contentType,
            path: a.path,
          })),
        });
      }
    }
  }
}
walk(json);
console.log(JSON.stringify(out, null, 2));
