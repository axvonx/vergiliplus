// Module table: which ring a module lives in and how to label it. Shared by the
// build-time renderer and the client islands (Sidebar, CmdK), so keep it tiny and
// dependency-free. Unknown modules still work (ring "user", label = name) — add them here.
export const MODULES = {
  ntoskrnl: { ring: "kernel", label: "ntoskrnl" },
  hal: { ring: "kernel", label: "hal" },
  win32k: { ring: "kernel", label: "win32k" },
  win32kbase: { ring: "kernel", label: "win32kbase" },
  win32kfull: { ring: "kernel", label: "win32kfull" },
  ci: { ring: "kernel", label: "ci" },
  fltmgr: { ring: "kernel", label: "fltmgr" },
  tcpip: { ring: "kernel", label: "tcpip" },
  ndis: { ring: "kernel", label: "ndis" },
  ntdll: { ring: "user", label: "ntdll" },
  kernelbase: { ring: "user", label: "kernelbase" },
  kernel32: { ring: "user", label: "kernel32" },
  combase: { ring: "user", label: "combase" },
};
export const RINGS = [
  { ring: "user", label: "Userland" },
  { ring: "kernel", label: "Kernel" },
];
export const RINGLABEL = { user: "userland", kernel: "kernel" };

export function modInfo(m) {
  return MODULES[m] || { ring: "user", label: m };
}
