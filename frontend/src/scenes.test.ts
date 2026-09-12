import { describe, expect, it } from "vitest";
import { actBackground, actBackgrounds, interludes } from "./scenes";

describe("actBackground", () => {
  it("gives each of the five acts its own artwork", () => {
    expect(actBackgrounds).toHaveLength(5);
    expect([0, 1, 2, 3, 4].map(actBackground)).toEqual([
      "/assets/office-morning.png",
      "/assets/cafeteria-noon.png",
      "/assets/finance-rain.png",
      "/assets/meeting-morning.png",
      "/assets/office.png",
    ]);
  });

  it("never returns undefined, falling back to the default artwork", () => {
    // `noUncheckedIndexedAccess` makes the lookup `string | undefined`; the
    // fallback is what keeps callers able to build a url() unconditionally.
    for (const act of [-1, 5, 99, Number.NaN, Number.MAX_SAFE_INTEGER]) {
      expect(actBackground(act)).toBe("/assets/office.png");
    }
  });

  it("returns a string for every act the backend allows", () => {
    // GameState constrains act to 0..4 inclusive.
    for (let act = 0; act <= 4; act += 1) {
      expect(typeof actBackground(act)).toBe("string");
      expect(actBackground(act)).toMatch(/^\/assets\/.+\.png$/);
    }
  });
});

describe("interludes", () => {
  it("has authored monologues after acts 1 and 2 only", () => {
    expect(Object.keys(interludes)).toEqual(["1", "2"]);
    expect(interludes[0]).toBeUndefined();
    expect(interludes[3]).toBeUndefined();
    expect(interludes[4]).toBeUndefined();
  });

  it("pairs each monologue with its own scene art, place and time", () => {
    expect(interludes[1]).toMatchObject({
      image: "/assets/bedroom-night.png",
      location: "卧室 · 把注意力还给自己",
      time: "周五 · 夜间",
    });
    expect(interludes[2]).toMatchObject({
      image: "/assets/corridor-evening.png",
      location: "走廊 · 从流程回到事实",
      time: "周二 · 下班前",
    });
  });

  it("keeps both monologues non-empty and distinct", () => {
    const first = interludes[1]?.text ?? "";
    const second = interludes[2]?.text ?? "";
    expect(first.length).toBeGreaterThan(20);
    expect(second.length).toBeGreaterThan(20);
    expect(first).not.toBe(second);
  });
});
