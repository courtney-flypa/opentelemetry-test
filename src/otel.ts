import "./otel-fixes.ts";

import {
  ExportResult,
  ExportResultCode,
  hrTimeToMicroseconds
} from "@opentelemetry/core";
import {
  ConsoleSpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
  WebTracerProvider
} from "@opentelemetry/sdk-trace-web";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";

function generateSpanHTML(span: ReadableSpan, info) {
  const el = document.createElement("div");
  el.classList.add("span");
  el.innerHTML = `
  <dl class="span-info">
    <dt>traceId</dt><dd>${info.traceId}</dd>
    <dt>name</dt><dd>${info.name}</dd>
    <dt>id</dt><dd>${info.id}</dd>
    <dt>timestamp</dt><dd>${info.timestamp} <time>(${new Date(
    info.timestamp / 1000
  ).toISOString()})</time></dd>
    <dt>duration</dt><dd>${info.duration} <time>(end: ${new Date(
    (info.timestamp + info.duration) / 1000
  ).toISOString()})</dd>
    <dt>attributes</dt><dl>
      ${Object.entries(info.attributes)
        .map(
          ([key, value]) => `
        <dt>${key}</dt><dd>${value}</dd>
      `
        )
        .join("")}
    </dl>
    <dt>events</dt><dl>
      ${info.events
        .map(
          ({ name, time }) => `
        <dt>${name}</dt><dd>${time} <time>(${new Date(
            time / 1000
          ).toISOString()})</dd>
      `
        )
        .join("")}
    </dl>
  </dl>
  
  <details>
  <summary>Full console dump</summary>
  <pre>${JSON.stringify(info, undefined, 2)}</pre>
  </details>
  `;

  return el;
}

// @ts-expect-error yeet the restrictions away
class OutputExporter extends ConsoleSpanExporter {
  _sendSpans(
    spans: ReadableSpan[],
    done?: (result: ExportResult) => void
  ): void {
    for (const span of spans) {
      // @ts-expect-error yeet the restrictions away
      const info = this._exportInfo(span);
      info.events.forEach(
        (event) => (event.time = hrTimeToMicroseconds(event.time))
      );

      document.getElementById("output").prepend(generateSpanHTML(span, info));
      // csb doesn't do console.dir
      console.log(info);
    }
    if (done) {
      return done({ code: ExportResultCode.SUCCESS });
    }
  }
}

const provider = new WebTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new OutputExporter()));

provider.register();

registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new XMLHttpRequestInstrumentation(),
    new FetchInstrumentation(),
    new UserInteractionInstrumentation(),
  ]
});
