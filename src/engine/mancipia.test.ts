import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { labourPool, MANCIPIA_LABOUR_DAYS } from "./labour";
import { peopleHappinessPressures } from "./peopleHappiness";
import { WorldStateSchema } from "./schema";

describe("mancipia (Constitution §4.3 unfree)", () => {
  it("add callable men-days every season, are excluded from the levy, and weigh on the free tenants' happiness", () => {
    const s = WorldStateSchema.parse(JSON.parse(JSON.stringify(startingEstate)));
    const before = labourPool(s).men;
    s.population.mancipia = 10;
    expect(labourPool(s).men).toBe(before + 10 * MANCIPIA_LABOUR_DAYS);
    expect(s.population.adult_men).toBe(12); // levy pool untouched
    const unfree = peopleHappinessPressures(s).find((p) => p.id === "unfree");
    expect(unfree?.delta).toBe(-2);
    s.population.mancipia = 40;
    expect(peopleHappinessPressures(s).find((p) => p.id === "unfree")?.delta).toBe(-6); // capped
    s.population.mancipia = 4;
    expect(peopleHappinessPressures(s).find((p) => p.id === "unfree")).toBeUndefined();
  });
});
