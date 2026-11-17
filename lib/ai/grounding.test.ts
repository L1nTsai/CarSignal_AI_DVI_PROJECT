import { describe, expect, it } from "vitest";
import { extractNumberTokens, spokenNumbersToDigits, unsupportedNumbers } from "./grounding";

describe("unsupportedNumbers", () => {
  it("brief examples: no numbers, nothing flagged", () => {
    expect(unsupportedNumbers("The inner edge of the tire is worn.", ["The inner edge is worn. Mark it needs attention."])).toEqual([]);
    expect(unsupportedNumbers("The wipers look good.", ["These look good."])).toEqual([]);
  });

  it("flags an invented measurement, with its unit", () => {
    expect(unsupportedNumbers("The inner edge is worn to 4 mm.", ["The inner edge is worn."])).toEqual(["4 mm"]);
  });

  it("flags the seed-demo invented mileage", () => {
    expect(unsupportedNumbers("Replace the filter in 12,000 miles.", ["Air filter is pretty dirty."])).toEqual(["12,000 miles"]);
  });

  it("accepts numbers the tech said, in the same form", () => {
    expect(unsupportedNumbers("Tread is at 4/32.", ["tread's at 4/32, put it on monitor"])).toEqual([]);
    expect(unsupportedNumbers("Front pads are at 3 mm.", ["front pads at 3 mm"])).toEqual([]);
    expect(unsupportedNumbers("Pressure is 35 psi.", ["she's at 35 psi"])).toEqual([]);
  });

  it("accepts equivalent spellings of the same value and unit", () => {
    expect(unsupportedNumbers("Front pads are at 3 mm.", ["front pads are at 3 millimeters"])).toEqual([]);
    expect(unsupportedNumbers("About 12,000 miles since service.", ["about 12000 miles since service"])).toEqual([]);
    expect(unsupportedNumbers("About 12,000 miles since service.", ["about 12k miles since service"])).toEqual([]);
    expect(unsupportedNumbers("Pads at 3mm.", ["pads at 3 mm"])).toEqual([]);
    expect(unsupportedNumbers("Battery is at 12.0 V.", ["battery's reading 12 volts"])).toEqual([]);
    expect(unsupportedNumbers("Tread is 4/32.", ["tread is 4/32nds"])).toEqual([]);
  });

  it("accepts spoken numbers in quotes", () => {
    expect(unsupportedNumbers("Tread is at 4/32.", ["tread is at four thirty-seconds"])).toEqual([]);
    expect(unsupportedNumbers("Tread is at 4/32.", ["tread is at four thirty seconds"])).toEqual([]);
    expect(unsupportedNumbers("Pressure is 35 psi.", ["pressure's thirty five psi"])).toEqual([]);
    expect(unsupportedNumbers("Around 12,000 miles.", ["around twelve thousand miles"])).toEqual([]);
    expect(unsupportedNumbers("Pads at 2.5 mm.", ["pads at two point five millimeters"])).toEqual([]);
  });

  it("flags a changed value", () => {
    expect(unsupportedNumbers("Tread is at 3/32.", ["tread is at 4/32"])).toEqual(["3/32"]);
    expect(unsupportedNumbers("Tread is at 1/8.", ["tread is at 4/32"])).toEqual(["1/8"]);
    expect(unsupportedNumbers("Pads at 3.5 mm.", ["pads at 3 mm"])).toEqual(["3.5 mm"]);
  });

  it("flags a unit the tech didn't say, or a different unit", () => {
    expect(unsupportedNumbers("Pressure is 35 psi.", ["it's at 35"])).toEqual(["35 psi"]);
    expect(unsupportedNumbers("Pads at 3 mm.", ["pads at 3 inches"])).toEqual(["3 mm"]);
  });

  it("a unitless note number is supported by the same value with a unit", () => {
    expect(unsupportedNumbers("Tire pressure reads 35.", ["reads 35 psi"])).toEqual([]);
  });

  it("checks against every quote of the line", () => {
    expect(unsupportedNumbers("Inner edge worn; tread at 3/32.", ["inner edge is worn", "came back to it, 3/32"])).toEqual([]);
  });

  it("flags percentages, money, and years", () => {
    expect(unsupportedNumbers("Brake fluid at 3% moisture.", ["brake fluid is dark"])).toEqual(["3%"]);
    expect(unsupportedNumbers("Estimated $250 to replace.", ["needs replacing"])).toEqual(["$250"]);
    expect(unsupportedNumbers("Battery is from 2019.", ["battery's old"])).toEqual(["2019"]);
  });

  it("returns each unsupported token once, in order", () => {
    expect(unsupportedNumbers("2 mm on the left, 3 mm on the right, 2 mm rear.", ["worn"])).toEqual(["2 mm", "3 mm"]);
  });

  it("ignores codes glued to letters", () => {
    expect(unsupportedNumbers("Code P0420 is stored.", ["there's a P0420"])).toEqual([]);
    expect(extractNumberTokens("V6 engine")).toEqual([]);
  });
});

describe("extractNumberTokens", () => {
  it("parses value and unit", () => {
    expect(extractNumberTokens("12,000 miles, 4/32, 3mm, 35 PSI, 50%")).toEqual([
      { text: "12,000 miles", value: "12000", unit: "mi" },
      { text: "4/32", value: "4/32", unit: null },
      { text: "3mm", value: "3", unit: "mm" },
      { text: "35 PSI", value: "35", unit: "psi" },
      { text: "50%", value: "50", unit: "%" },
    ]);
  });
  it("does not take a unit out of a longer word", () => {
    expect(extractNumberTokens("2 mileage")).toEqual([{ text: "2", value: "2", unit: null }]);
  });
});

describe("spokenNumbersToDigits", () => {
  it.each([
    ["four thirty-seconds", "4/32"],
    ["thirty five psi", "35 psi"],
    ["one hundred and twenty miles", "120 miles"],
    ["twelve thousand miles", "12000 miles"],
    ["two point five mil", "2.5 mil"],
    ["about thirty seconds", "about 30 seconds"],
    ["two and three", "2 and 3"],
    ["no numbers here", "no numbers here"],
  ])("%s -> %s", (input, out) => {
    expect(spokenNumbersToDigits(input)).toBe(out);
  });
});
