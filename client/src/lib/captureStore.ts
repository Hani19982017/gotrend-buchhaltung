// Holds files picked from the camera / file chooser until the entry form takes them.
let pending: File[] = [];
let lastYm: string | null = null;

export const captureStore = {
  set(files: File[]) {
    pending = files;
  },
  peek(): File[] {
    return pending;
  },
  clear() {
    pending = [];
  },
  setYm(ym: string) {
    lastYm = ym;
  },
  ym() {
    return lastYm;
  },
};
