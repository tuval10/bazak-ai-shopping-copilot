import { parseProfile } from "@/api-client/profile";

describe("parseProfile", () => {
  it("keeps only the filled working-memory fields", () => {
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

  it("returns nothing for a null or empty profile", () => {
    expect(parseProfile(null)).toEqual([]);
    expect(parseProfile("")).toEqual([]);
    expect(parseProfile("# User Preferences\n- Name:\n- Budget:")).toEqual([]);
  });
});
