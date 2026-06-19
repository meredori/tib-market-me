import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrations";
import {
  getAccessSummary,
  listAccessRequirements,
  listAccessStates,
  saveAccessRequirement,
  saveAccessState
} from "./index";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("access unlock tracking", () => {
  it("stores manual requirements and access states", () => {
    const requirement = saveAccessRequirement(db, {
      entity_type: "hunting_place",
      entity_id: 100,
      requirement_type: "quest",
      label: "The New Frontier",
      notes: "Needed for the route"
    }) as Record<string, any>;
    expect(requirement.ok).toBe(true);
    expect(requirement.item.label).toBe("The New Frontier");

    const state = saveAccessState(db, {
      entity_type: "hunting_place",
      entity_id: 100,
      requirement_id: requirement.item.id,
      character_name: "Knight One",
      state: "available"
    }) as Record<string, any>;
    expect(state.ok).toBe(true);

    const requirements = listAccessRequirements(db, { entity_type: "hunting_place", entity_id: 100 }) as Record<string, any>;
    const states = listAccessStates(db, { entity_type: "hunting_place", entity_id: 100, character_name: "Knight One" }) as Record<string, any>;
    expect(requirements.items).toHaveLength(1);
    expect(states.items).toHaveLength(1);
  });

  it("prefers character-specific state over account or local state", () => {
    saveAccessState(db, {
      entity_type: "hunting_place",
      entity_id: 100,
      scope_type: "local",
      state: "available"
    });
    saveAccessState(db, {
      entity_type: "hunting_place",
      entity_id: 100,
      account_name: "Main",
      state: "unknown"
    });
    saveAccessState(db, {
      entity_type: "hunting_place",
      entity_id: 100,
      account_name: "Main",
      character_name: "Knight One",
      state: "unavailable"
    });

    const summary = getAccessSummary(db, { entity_id: 100, account_name: "Main", character_name: "Knight One" });
    expect(summary.state).toBe("unavailable");
    expect(summary.scope.type).toBe("character");
    expect(summary.blockers[0].label).toBe("access unavailable");
  });

  it("keeps unknown access distinct from unavailable access", () => {
    const unknown = getAccessSummary(db, { entity_id: 100 });
    expect(unknown.state).toBe("unknown");
    expect(unknown.warnings).toHaveLength(1);
    expect(unknown.blockers).toHaveLength(0);

    saveAccessState(db, {
      entity_type: "hunting_place",
      entity_id: 100,
      state: "unavailable"
    });
    const blocked = getAccessSummary(db, { entity_id: 100 });
    expect(blocked.state).toBe("unavailable");
    expect(blocked.blockers).toHaveLength(1);
  });
});
