import { addDays, fmt } from "./format";
import { toCsv } from "./api";

describe("formatters", () => {
  it("formats percentages and signed deltas", () => {
    expect(fmt.pct(74.333)).toBe("74.3%");
    expect(fmt.signed(2.5, 1, "%")).toBe("+2.5%");
    expect(fmt.signed(-3, 0)).toBe("−3");
  });
  it("adds days across month boundaries", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
  it("escapes CSV values", () => {
    expect(toCsv([{ a: "x,y", b: 'he said "hi"' }])).toBe('a,b\n"x,y","he said ""hi"""');
  });
});
