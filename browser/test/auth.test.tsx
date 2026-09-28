/**
 * VITE_DISABLE_AUTH=1 is the documented localhost path, and it renders with no
 * ConvexAuthProvider in the tree. Nothing in the header may reach for one, or
 * the page is blank and the only trace is a console error.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the header with auth disabled", () => {
  it("renders nothing for sign-out instead of throwing without an auth provider", async () => {
    vi.stubEnv("VITE_DISABLE_AUTH", "1");
    const { AuthButton } = await import("../src/Auth.tsx");
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(<AuthButton />);
    });
    expect(host.innerHTML).toBe("");
    root.unmount();
  });
});
