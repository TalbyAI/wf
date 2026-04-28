import { describe, expect, it } from "vitest";

import { describeCore } from "./index";

describe("core package", () => {
  it("describes the package", () => {
    expect(describeCore()).toBe("core package ready");
  });
});
