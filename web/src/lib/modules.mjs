// Module table: which ring a module lives in and how to label it (build time only).
// Only modules whose public PDBs carry types (docs/module-survey.md); unknown modules still
// work (ring "user", label = name) — add them here.
export const MODULES = {
  ntoskrnl: { ring: "kernel", label: "ntoskrnl" },
  ndis: { ring: "kernel", label: "ndis" },
  fltmgr: { ring: "kernel", label: "fltmgr" },
  ntdll: { ring: "user", label: "ntdll" },
};
export function modInfo(m) {
  return MODULES[m] || { ring: "user", label: m };
}
