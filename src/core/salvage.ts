/**
 * Recovery for model output that is *mostly* right. The strict schemas in contracts.ts stay the
 * contract; these helpers only remove what cannot be kept (malformed list items, extra keys,
 * over-long lists, dangling citations) and report how much was removed, so one bad entry no
 * longer throws away an otherwise usable — and already paid for — response.
 */
import { z } from "zod";
import { Draft, validateDraft, type DraftType, type Evidence } from "../contracts";

type AnyObject = z.ZodObject<z.ZodRawShape>;

/**
 * Parses `value` with a strict object schema after dropping unknown keys, stripping unknown keys
 * inside list items, discarding list items that still fail, and truncating lists to their max.
 * Throws only if the remaining scalar fields are themselves unusable.
 */
export function salvage<S extends AnyObject>(schema: S, value: unknown): { data: z.infer<S>; dropped: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { data: schema.parse(value), dropped: 0 };
  let dropped = 0;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let v = (value as Record<string, unknown>)[key];
    if (field instanceof z.ZodArray && Array.isArray(v)) {
      const element = field.element instanceof z.ZodObject ? field.element.strip() : field.element;
      const max: number = field._def.maxLength?.value ?? Infinity;
      const kept = v.flatMap((item) => {
        const r = (element as z.ZodTypeAny).safeParse(item);
        return r.success ? [r.data] : [];
      });
      dropped += v.length - Math.min(kept.length, max);
      v = kept.slice(0, max);
    } else if (v && typeof v === "object") {
      // Nested object, possibly wrapped in .nullable()/.optional() (e.g. micro_check).
      const inner = field instanceof z.ZodNullable || field instanceof z.ZodOptional ? field.unwrap() : field;
      if (inner instanceof z.ZodObject) {
        const r = inner.strip().safeParse(v);
        if (r.success) v = r.data;
      }
    }
    if (v !== undefined) out[key] = v;
  }
  return { data: schema.parse(out), dropped };
}

/** salvage(), but returns undefined instead of throwing when nothing usable is left. */
export function trySalvage<S extends AnyObject>(schema: S, value: unknown) {
  try {
    return salvage(schema, value);
  } catch {
    return undefined;
  }
}

/**
 * Mechanically repairs the citation bookkeeping validateDraft() insists on. Never invents
 * content: it only removes references that point nowhere and downgrades claims whose stated
 * basis can no longer be backed.
 */
export function tidyDraft(input: DraftType, evidence: Evidence[]): { draft: DraftType; fixes: number } {
  const d: DraftType = structuredClone(input);
  const valid = new Set(evidence.map((e) => e.source_id));
  let fixes = 0;
  const reserved = new Set(["brief", "return_to_source"]);
  d.sections = d.sections.filter((s) => {
    if (reserved.has(s.local_id)) return fixes++, false;
    reserved.add(s.local_id);
    return true;
  });
  const sections = new Set(["brief", "return_to_source", ...d.sections.map((s) => s.local_id)]);
  for (const s of d.sections) {
    const body = s.body_markdown.replace(/\[(S\d+)\]/g, (m, ref) => (valid.has(ref) ? m : (fixes++, "")));
    const refs = [...new Set([...body.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]))];
    if (refs.join() !== s.evidence_ids.join()) fixes++;
    s.body_markdown = body;
    s.evidence_ids = refs;
  }
  const seen = new Set<string>();
  d.claims = d.claims.flatMap((c) => {
    if (seen.has(c.local_id)) return fixes++, [];
    seen.add(c.local_id);
    const evidenceIds = c.evidence_ids.filter((i) => valid.has(i));
    const appearsIn = c.appears_in.filter((x) => sections.has(x));
    if (!appearsIn.length) return fixes++, [];
    const claim = { ...c, evidence_ids: evidenceIds, appears_in: appearsIn };
    if (evidenceIds.length !== c.evidence_ids.length || appearsIn.length !== c.appears_in.length) fixes++;
    if (
      claim.basis === "derived" &&
      !(claim.derivation_section_id && d.sections.some((s) => s.local_id === claim.derivation_section_id))
    ) {
      claim.basis = "uncertain";
      claim.derivation_section_id = null;
      fixes++;
    }
    if (claim.basis === "source_statement" && !claim.evidence_ids.length) {
      claim.basis = "uncertain";
      fixes++;
    }
    return [claim];
  });
  return { draft: d, fixes };
}

/** Strict validation first; otherwise salvage + tidy. Returns undefined if still not a valid draft. */
export function recoverDraft(value: unknown, evidence: Evidence[]) {
  try {
    return { draft: validateDraft(value, evidence), fixes: 0 };
  } catch {
    const salvaged = trySalvage(Draft, value);
    if (!salvaged) return undefined;
    const tidy = tidyDraft(salvaged.data, evidence);
    try {
      return { draft: validateDraft(tidy.draft, evidence), fixes: salvaged.dropped + tidy.fixes };
    } catch {
      return undefined;
    }
  }
}
