import { describe, expect, it, vi } from "vitest";

import { formatWelcome, main } from "./index";

describe("cli entrypoint", () => {
  it("formats the welcome message", () => {
    expect(formatWelcome()).toBe("talby-wf cli ready (core package ready)");
  });

  it("writes the welcome message", () => {
    const log = vi.fn();

    main({ log });

    expect(log).toHaveBeenCalledWith("talby-wf cli ready (core package ready)");
  });
});
