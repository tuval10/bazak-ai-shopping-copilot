import { parseProfile } from "@/api-client/profile";

describe("parseProfile", () => {
  it("maps the filled fields of structured (JSON) working memory", () => {
    const json = JSON.stringify({
      name: "",
      budget: "~$50",
      preferredCategories: ["audio", "phones"],
      preferredBrands: [],
      dislikes: ["refurbished"],
      notes: "   ",
    });
    expect(parseProfile(json)).toEqual([
      { label: "Budget", value: "~$50" },
      { label: "Preferred categories", value: "audio, phones" },
      { label: "Dislikes", value: "refurbished" },
    ]);
  });

  it("renders fields in schema order regardless of key order", () => {
    const json = JSON.stringify({ notes: "wants cheapest first", budget: "$300" });
    expect(parseProfile(json)).toEqual([
      { label: "Budget", value: "$300" },
      { label: "Notes", value: "wants cheapest first" },
    ]);
  });

  it("falls back to `- Label: value` markdown working memory", () => {
    const md = [
      "# User Preferences",
      "- Name:",
      "- Budget: ~$50",
      "- Preferred categories: audio, phones",
      "- Preferred brands:",
      "- Dislikes: refurbished",
      "- Notes:   ",
    ].join("\n");
    expect(parseProfile(md)).toEqual([
      { label: "Budget", value: "~$50" },
      { label: "Preferred categories", value: "audio, phones" },
      { label: "Dislikes", value: "refurbished" },
    ]);
  });

  it("returns nothing for a null, empty, or empty-object profile", () => {
    expect(parseProfile(null)).toEqual([]);
    expect(parseProfile("")).toEqual([]);
    expect(parseProfile("{}")).toEqual([]);
    expect(parseProfile("# User Preferences\n- Name:\n- Budget:")).toEqual([]);
  });
});
