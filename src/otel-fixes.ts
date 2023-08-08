// This references the first PR
// https://github.com/open-telemetry/opentelemetry-js/pull/3384

import api, { TraceFlags } from "@opentelemetry/api";
import {
  Context,
  HrTime,
  SpanAttributeValue,
  SpanContext,
  SpanKind,
  Link,
  TimeInput
} from "@opentelemetry/api";
import {
  Clock,
  hrTimeDuration,
  isTimeInput,
  isTracingSuppressed,
  otperformance,
  timeInputToHrTime,
  sanitizeAttributes,
  hrTimeToMilliseconds
} from "@opentelemetry/core";
import {
  Span as BaseSpan,
  Tracer as BaseTracer
} from "@opentelemetry/sdk-trace-base";
import {
  SamplingDecision,
  WebTracerProvider as BaseWebTracerProvider
} from "@opentelemetry/sdk-trace-web";

// packages/opentelemetry-core/src/common/time.ts
const NANOSECOND_DIGITS = 9;
const SECOND_TO_NANOSECONDS = Math.pow(10, NANOSECOND_DIGITS);

function addHrTimes(time1: HrTime, time2: HrTime): HrTime {
  const out: HrTime = [time1[0] + time2[0], time1[1] + time2[1]];

  if (out[1] > SECOND_TO_NANOSECONDS) {
    out[0] = out[0] + Math.floor(out[1] / SECOND_TO_NANOSECONDS);
    out[1] = out[1] % SECOND_TO_NANOSECONDS;
  }

  return out;
}

// packages/opentelemetry-sdk-trace-base/src/Span.ts
class Span extends BaseSpan {
  private readonly _providedStartTime?: HrTime;
  private readonly _performanceStartTime: number;
  private readonly _performanceOffset: number;

  constructor(
    parentTracer: BaseTracer,
    context: Context,
    spanName: string,
    spanContext: SpanContext,
    kind: SpanKind,
    parentSpanId?: string,
    links: Link[] = [],
    startTime?: TimeInput,
    clock: Clock = otperformance
  ) {
    super(
      parentTracer,
      context,
      spanName,
      spanContext,
      kind,
      parentSpanId,
      links,
      startTime,
      clock
    );

    // PR changes START
    const now = Date.now();
    this._performanceStartTime = otperformance.now();
    this._performanceOffset =
      now - (this._performanceStartTime + otperformance.timeOrigin);

    // if startTime is a number smaller than the start of the process
    // assume it is a performance API timestamp and apply correction as needed
    if (typeof startTime === "number" && startTime < otperformance.timeOrigin) {
      startTime += this._performanceOffset;
    }

    this.startTime = timeInputToHrTime(startTime ? startTime : now);
    // PR CHANGES END

    console.log(
      this._spanContext.spanId,
      "Input startTime",
      startTime,
      "span startTime",
      this.startTime,
      hrTimeToMilliseconds(this.startTime)
    );
  }

  addEvent(
    name: string,
    attributesOrStartTime?: api.SpanAttributes | api.TimeInput,
    timeStamp?: api.TimeInput
  ): this {
    if (this._isSpanEnded()) return this;
    if (this._spanLimits.eventCountLimit === 0) {
      api.diag.warn("No events allowed.");
      return this;
    }
    if (this.events.length >= this._spanLimits.eventCountLimit!) {
      api.diag.warn("Dropping extra events.");
      this.events.shift();
    }

    if (isTimeInput(attributesOrStartTime)) {
      if (!isTimeInput(timeStamp)) {
        timeStamp = attributesOrStartTime;
      }
      attributesOrStartTime = undefined;
    }

    const attributes = sanitizeAttributes(attributesOrStartTime);
    this.events.push({
      name,
      attributes,
      time: this._getTimeAfterStart(timeStamp)
    });
    return this;
  }

  end(endTime?: api.TimeInput): void {
    if (this._isSpanEnded()) {
      api.diag.error("You can only call end() on a span once.");
      return;
    }
    this._ended = true;

    // PR CHANGES START
    this.endTime = this._getTimeAfterStart(endTime);
    // PR CHANGES END
    this._duration = hrTimeDuration(this.startTime, this.endTime);

    console.log(
      this._spanContext.spanId,
      "Input endTime",
      endTime,
      "span endTime",
      this.endTime,
      hrTimeToMilliseconds(this.endTime),
      "duration",
      this.duration,
      hrTimeToMilliseconds(this.duration)
    );

    if (this._duration[0] < 0) {
      api.diag.warn(
        "Inconsistent start and end time, startTime > endTime. Setting span duration to 0ms.",
        this.startTime,
        this.endTime
      );
      this.endTime = this.startTime.slice() as HrTime;
      this._duration = [0, 0];
    }

    this._spanProcessor.onEnd(this);
  }

  private _getTimeAfterStart(inp?: api.TimeInput): api.HrTime {
    const provided = inp != null ? timeInputToHrTime(inp) : undefined;

    if (this._providedStartTime != null) {
      if (provided != null) {
        // both start and current time provided by user
        return provided;
      }

      // start time provided but current time not provided by user
      return timeInputToHrTime(Date.now());
    }

    if (provided != null) {
      const duration = hrTimeDuration(this.startTime, provided);
      if (duration[0] < 0) {
        return addHrTimes(provided, [0, this._performanceOffset * 1000000]);
      }
      return provided;
    }

    const msDuration = otperformance.now() - this._performanceStartTime;
    return addHrTimes(this.startTime, [0, msDuration * 1000000]);
  }
}

// Hijack Tracer startSpan with a copy of live code that references patched Span
BaseTracer.prototype.startSpan = function (
  name: string,
  options: api.SpanOptions = {},
  context = api.context.active()
): api.Span {
  // remove span from context in case a root span is requested via options
  if (options.root) {
    context = api.trace.deleteSpan(context);
  }
  const parentSpan = api.trace.getSpan(context);

  if (isTracingSuppressed(context)) {
    api.diag.debug("Instrumentation suppressed, returning Noop Span");
    const nonRecordingSpan = api.trace.wrapSpanContext(
      api.INVALID_SPAN_CONTEXT
    );
    return nonRecordingSpan;
  }

  const parentSpanContext = parentSpan ? parentSpan.spanContext() : undefined;
  const spanId = this._idGenerator.generateSpanId();
  let traceId;
  let traceState;
  let parentSpanId;
  if (!parentSpanContext || !api.trace.isSpanContextValid(parentSpanContext)) {
    // New root span.
    traceId = this._idGenerator.generateTraceId();
  } else {
    // New child span.
    traceId = parentSpanContext.traceId;
    traceState = parentSpanContext.traceState;
    parentSpanId = parentSpanContext.spanId;
  }

  const spanKind = options.kind ? options.kind : SpanKind.INTERNAL;
  const links = (options.links ? options.links : []).map((link) => {
    return {
      context: link.context,
      attributes: sanitizeAttributes(link.attributes)
    };
  });
  const attributes = sanitizeAttributes(options.attributes);
  // make sampling decision
  const samplingResult = this._sampler.shouldSample(
    context,
    traceId,
    name,
    spanKind,
    attributes,
    links
  );

  const traceFlags =
    samplingResult.decision === SamplingDecision.RECORD_AND_SAMPLED
      ? TraceFlags.SAMPLED
      : TraceFlags.NONE;
  const spanContext = { traceId, spanId, traceFlags, traceState };
  if (samplingResult.decision === SamplingDecision.NOT_RECORD) {
    api.diag.debug(
      "Recording is off, propagating context in a non-recording span"
    );
    const nonRecordingSpan = api.trace.wrapSpanContext(spanContext);
    return nonRecordingSpan;
  }

  const span = new Span(
    this,
    context,
    name,
    spanContext,
    spanKind,
    parentSpanId,
    links,
    options.startTime
  );
  // Set initial span attributes. The attributes object may have been mutated
  // by the sampler, so we sanitize the merged attributes before setting them.
  const initAttributes = sanitizeAttributes(
    Object.assign(attributes, samplingResult.attributes)
  );
  span.setAttributes(initAttributes);
  return span;
};
