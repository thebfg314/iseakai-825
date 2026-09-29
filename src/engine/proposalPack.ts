import type { MechanicalProposal } from "./schema";
import { lookupProject } from "./projectCatalog";

export type PackProposal = {
  id: string;
  status: string;
  proposal: MechanicalProposal;
  rejectReason?: string;
};

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addAlias(into: Set<string>, value?: string) {
  if (!value?.trim()) return;
  const n = norm(value);
  into.add(n);
  into.add(n.replace(/ /g, "_"));
}

export function startWorkAliases(item: PackProposal): Set<string> {
  const aliases = new Set<string>();
  if (item.proposal.type !== "start_project") return aliases;
  const proposal = item.proposal;
  addAlias(aliases, item.id);
  addAlias(aliases, proposal.id);
  addAlias(aliases, proposal.projectKey);
  addAlias(aliases, proposal.name);
  const catalog = lookupProject(proposal.projectKey);
  if (catalog) {
    addAlias(aliases, catalog.key);
    addAlias(aliases, catalog.name);
  }
  return aliases;
}

export function workLabelOf(item: PackProposal): string {
  if (item.proposal.type !== "start_project") return "that work";
  const proposal = item.proposal;
  return proposal.name?.trim() || lookupProject(proposal.projectKey)?.name || proposal.projectKey.replaceAll("_", " ");
}

/** Hall phrasing: "the organized charcoal burning". */
export function theWork(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "that work";
  if (/^(the|a|an)\b/i.test(trimmed)) return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return `the ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

export function isWorkFollowOn(proposal: MechanicalProposal): proposal is Extract<MechanicalProposal, { type: "assign_labour" | "adjust_project" }> {
  return proposal.type === "assign_labour" || proposal.type === "adjust_project";
}

export function matchingStarts<T extends PackProposal>(ref: string, items: T[]): T[] {
  if (!ref || ref === "unassigned") return [];
  const n = norm(ref);
  const underscored = n.replace(/ /g, "_");
  return items.filter((item) => {
    if (item.proposal.type !== "start_project") return false;
    const aliases = startWorkAliases(item);
    return aliases.has(n) || aliases.has(underscored);
  });
}

/** The single start in this pack that this hands/change line was written for. */
export function dependentStart<T extends PackProposal>(item: T, items: T[]): T | undefined {
  if (!isWorkFollowOn(item.proposal)) return undefined;
  if (item.proposal.projectId === "unassigned") return undefined;
  const matches = matchingStarts(item.proposal.projectId, items);
  if (matches.length !== 1) return undefined;
  return matches[0];
}

export type ConfirmGate = { blocked: boolean; note?: string };

export function confirmGate(item: PackProposal, items: PackProposal[]): ConfirmGate {
  if (item.status === "withheld") {
    return {
      blocked: true,
      note: item.rejectReason?.trim() || "That work was not begun, so this change is set aside.",
    };
  }
  const dep = dependentStart(item, items);
  if (!dep || dep.status === "applied") return { blocked: false };
  if (dep.status === "pending") {
    return {
      blocked: true,
      note: `This follows ${theWork(workLabelOf(dep))}. Confirm that work first, or confirm all.`,
    };
  }
  const name = theWork(workLabelOf(dep));
  return {
    blocked: true,
    note: `${name.charAt(0).toUpperCase()}${name.slice(1)} was not begun, so this change is set aside.`,
  };
}

export function dependentSkipLine(workName: string): string {
  const name = theWork(workName);
  const sentence = `${name} was not begun, so I have not called hands to it or changed it.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function dependentDeclineLine(workName: string): string {
  const name = theWork(workName);
  const sentence = `You declined ${name}, so I have not called hands to it or changed it.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
