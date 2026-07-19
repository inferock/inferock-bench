import { describe, expect, it } from "vitest";
import { SseAccumulator } from "./sse.js";

describe("SseAccumulator", () => {
  it("strips only the single optional SSE field space", () => {
    const parser = new SseAccumulator();

    expect(parser.push("event:  custom\ndata:  indented\n\n")).toEqual([{
      event: " custom",
      data: " indented",
    }]);
  });

  it("preserves data indentation across multi-line frames", () => {
    const parser = new SseAccumulator();

    expect(parser.push("data: first\ndata:  second\n\n")).toEqual([{
      data: "first\n second",
    }]);
  });
});
