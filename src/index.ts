import "./style.css";
import "./drift-simulator.ts";
import "./otel.ts";

import { trace } from "@opentelemetry/api";

document.getElementById("do-fetch").addEventListener("click", (event) => {
  fetch(
    `https://httpbin.org/response-headers?timing-allow-origin=*&x-as-of=${Date.now()}`
  );
});

document.getElementById("do-week-ago").addEventListener("click", (event) => {
  const tracer = trace.getTracer("manual");
  const span = tracer.startSpan("Manual Span", {
    startTime: Date.now() - 7 * 24 * 60 * 60 * 1000
  });
  span.end(Date.now() - 6 * 24 * 60 * 60 * 1000);
});
