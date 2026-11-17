import { describe, expect, it } from "vitest";
import { unsupportedNumbers } from "./grounding";

describe("unsupportedNumbers", () => {
  it("flags a number that was never said, with its unit", () => {
    expect(
      unsupportedNumbers("The engine air filter is clean. Replace it in 12,000 miles.", [
        "Engine air filter is clean, mark it good.",
      ]),
    ).toEqual(["12,000 miles"]);
  });

  it("accepts numbers that appear in a quote as digits", () => {
    expect(
      unsupportedNumbers("The front brake pads are at about 4 millimeters.", [
        "Front brake pads, they're at about 4 millimeters, put them on monitor.",
      ]),
    ).toEqual([]);
  });

  it("accepts numbers spoken as words", () => {
    expect(unsupportedNumbers("Pads at 4 mm.", ["they're at about four millimeters"])).toEqual([]);
    expect(unsupportedNumbers("Tread at 25%.", ["maybe twenty-five percent left"])).toEqual([]);
    expect(unsupportedNumbers("Due in 12,000 miles.", ["in twelve thousand miles"])).toEqual([]);
    expect(unsupportedNumbers("Due in 12k miles.", ["in 12,000 miles"])).toEqual([]);
  });

  it("checks fractions as a whole", () => {
    expect(unsupportedNumbers("Tread is 4/32.", ["tread is at 4/32"])).toEqual([]);
    expect(unsupportedNumbers("Tread is 4/32.", ["tread is at 4"])).toEqual(["4/32"]);
  });

  it("checks against every quote of the line", () => {
    expect(unsupportedNumbers("Worn at 2 and 3 mm.", ["the first is 2", "other one 3 mm"])).toEqual([]);
  });

  it("checks decimals and ignores comma formatting", () => {
    expect(unsupportedNumbers("Battery at 12.4 volts.", ["reads 12.4"])).toEqual([]);
    expect(unsupportedNumbers("Battery at 12.4 volts.", ["reads 12"])).toEqual(["12.4 volts"]);
    expect(unsupportedNumbers("At 1000 miles.", ["at 1,000"])).toEqual([]);
  });

  it("doesn't attach ordinary words as units and dedupes", () => {
    expect(unsupportedNumbers("Replace 2 wipers, 2 wipers.", [])).toEqual(["2"]);
  });

  it("returns nothing for a note without numbers", () => {
    expect(unsupportedNumbers("The wipers look good.", ["These look good."])).toEqual([]);
  });
});
