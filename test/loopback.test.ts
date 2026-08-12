import { describe, expect, it } from "vitest";
import { startLoopback } from "../src/auth/loopback.js";
import { LoginFlowError } from "../src/auth/errors.js";

// Real HTTP servers on 127.0.0.1 ephemeral-ish test ports (distinct from the
// production candidates so a real login during a test run cannot collide).
const TEST_PORTS = [18976, 18977, 18978];

describe("loopback", () => {
  it("resolves with the code on a valid callback and renders a success page", async () => {
    const server = await startLoopback({ candidatePorts: TEST_PORTS, expectedState: "st_1" });
    const wait = server.waitForCallback();

    const res = await fetch(`${server.redirectUri}?code=code_1&state=st_1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("signed in to Scribe");
    await expect(wait).resolves.toEqual({ code: "code_1" });
  });

  it("rejects on state mismatch before reading the code", async () => {
    const server = await startLoopback({ candidatePorts: TEST_PORTS, expectedState: "st_good" });
    // Attach the rejection handler BEFORE triggering the callback so the
    // rejection is never unhandled for a tick.
    const assertion = server.waitForCallback().then(
      () => {
        throw new Error("expected the callback to reject");
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(LoginFlowError);
        expect(String(err)).toMatch(/CSRF/);
      },
    );

    const res = await fetch(`${server.redirectUri}?code=code_1&state=st_evil`);
    expect(res.status).toBe(400);
    await assertion;
  });

  it("rejects on provider error and HTML-escapes the description", async () => {
    const server = await startLoopback({ candidatePorts: TEST_PORTS, expectedState: "st_1" });
    const assertion = expect(server.waitForCallback()).rejects.toThrow(/access_denied/);

    const res = await fetch(
      `${server.redirectUri}?error=access_denied&error_description=${encodeURIComponent("<script>alert(1)</script>")}`,
    );
    const html = await res.text();
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    await assertion;
  });

  it("404s other paths and keeps waiting", async () => {
    const server = await startLoopback({ candidatePorts: TEST_PORTS, expectedState: "st_1" });
    const wait = server.waitForCallback();

    const res = await fetch(`http://127.0.0.1:${server.port}/favicon.ico`);
    expect(res.status).toBe(404);

    await fetch(`${server.redirectUri}?code=late_code&state=st_1`);
    await expect(wait).resolves.toEqual({ code: "late_code" });
  });

  it("skips a busy port and binds the next candidate", async () => {
    const first = await startLoopback({ candidatePorts: TEST_PORTS, expectedState: "a" });
    const second = await startLoopback({ candidatePorts: TEST_PORTS, expectedState: "b" });
    expect(second.port).not.toBe(first.port);
    expect(TEST_PORTS).toContain(second.port);
    first.close();
    second.close();
  });

  it("fails with a clear message when every candidate port is busy", async () => {
    const servers = await Promise.all(
      TEST_PORTS.map((_, i) =>
        startLoopback({ candidatePorts: [TEST_PORTS[i]], expectedState: String(i) }),
      ),
    );
    await expect(startLoopback({ candidatePorts: TEST_PORTS, expectedState: "x" })).rejects.toThrow(
      /all in use/,
    );
    for (const s of servers) s.close();
  });

  it("times out when the browser never calls back", async () => {
    const server = await startLoopback({
      candidatePorts: TEST_PORTS,
      expectedState: "st_1",
      timeoutMs: 50,
    });
    await expect(server.waitForCallback()).rejects.toThrow(/Timed out/);
  });
});
