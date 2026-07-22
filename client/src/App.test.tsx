// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthScreen, authRoute } from "./App";

beforeEach(() => {
  window.location.hash = "#login";
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("authentication UI", () => {
  it("submits login credentials and returns the authenticated session", async () => {
    const onAuthenticated = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: "u1", workspaceId: "w1", email: "admin@example.com", name: "Admin", role: "admin", status: "active" },
      csrfToken: "csrf-token"
    }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<AuthScreen error="" onAuthenticated={onAuthenticated} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password"), "ValidPassword123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(expect.objectContaining({ csrfToken: "csrf-token" })));
    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST", credentials: "include" }));
  });

  it("switches to password recovery without a page reload", async () => {
    render(<AuthScreen error="" onAuthenticated={vi.fn()} />);
    fireEvent.click(screen.getByRole("link", { name: "Forgot password?" }));
    expect(await screen.findByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset your password" })).toBeInTheDocument();
  });

  it("reads invitation and reset tokens from hash routes", () => {
    window.location.hash = "#accept-invite?token=invite-token";
    expect(authRoute()).toEqual({ mode: "accept-invite", token: "invite-token" });
    window.location.hash = "#reset-password?token=reset-token";
    expect(authRoute()).toEqual({ mode: "reset-password", token: "reset-token" });
  });
});
