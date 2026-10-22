import type { InstructionFlag } from "@sokan/contracts";

/**
 * Text inside logs/build output that looks like an instruction to the agent (§7.2 point 4).
 * It is flagged and shown to the user; it never changes what the agent is allowed to do.
 */
const PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+instructions/i,
  /disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+/i,
  /approval\s+(?:is\s+|has\s+been\s+)?(?:already\s+)?granted/i,
  /you\s+are\s+now\s+(?:an?\s+)?(?:admin|root|system)/i,
  /\b(?:delete|drop|destroy|remove)\s+(?:the\s+)?(?:app|application|project|database)\b/i,
  /system\s*prompt/i,
  /دستور(?:ات|‌ها)?\s*(?:قبلی|بالا)\s*را?\s*نادیده/,
  /تأیید\s*(?:قبلاً|از قبل)?\s*(?:داده|صادر)\s*شده/,
  /(?:اپ|برنامه|دیتابیس)\s*را?\s*حذف\s*کن/,
];

export function flagInstructions(lines: ReadonlyArray<{ id: string; text: string }>): InstructionFlag[] {
  const out: InstructionFlag[] = [];
  for (const l of lines) {
    if (PATTERNS.some((p) => p.test(l.text))) {
      out.push({ evidenceId: l.id, excerpt: l.text.slice(0, 200) });
    }
  }
  return out;
}
