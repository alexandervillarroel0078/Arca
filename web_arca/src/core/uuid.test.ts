import { afterEach, describe, expect, it, vi } from "vitest";
import { nuevoUuid } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("nuevoUuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("genera UUID v4 validos y distintos", () => {
    const ids = new Set(Array.from({ length: 200 }, () => nuevoUuid()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it("sin crypto.randomUUID (http en red local) arma el UUID con getRandomValues", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (b: Uint8Array) => {
        for (let i = 0; i < b.length; i++) b[i] = (i * 37 + 11) % 256;
        return b;
      },
    });
    expect(nuevoUuid()).toMatch(V4);
  });

  it("sin ningun crypto cae en Math.random y sigue siendo v4", () => {
    vi.stubGlobal("crypto", undefined);
    const a = nuevoUuid();
    const b = nuevoUuid();
    expect(a).toMatch(V4);
    expect(a).not.toBe(b);
  });
});
