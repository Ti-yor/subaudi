import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { API } from "./contracts";
const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);
const listen = (channel: string) => (cb: (v: any) => void) => {
  const fn = (_: unknown, v: unknown) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => void ipcRenderer.removeListener(channel, fn);
};
const api: API = {
  anki: invoke("anki"),
  remove: invoke("remove"),
  annotate: invoke("annotate"),
  savePdf: invoke("save-pdf"),
  restore: invoke("restore"),
  original: invoke("original"),
  external: invoke("external"),
  cloud: invoke("cloud"),
  overview: invoke("overview"),
  state: invoke("state"),
  doc: invoke("doc"),
  find: invoke("find"),
  ocr: invoke("ocr"),
  open: invoke("open"),
  importPaths: invoke("import-paths"),
  pathFor: (file) => webUtils.getPathForFile(file),
  pdf: invoke("pdf"),
  index: invoke("index"),
  explain: invoke("explain"),
  cancel: invoke("cancel"),
  settings: invoke("settings"),
  clearKey: invoke("clear-key"),
  testModel: invoke("test-model"),
  theme: invoke("theme"),
  dataFolder: invoke("data-folder"),
  session: invoke("session"),
  export: invoke("export"),
  flag: invoke("flag"),
  correct: invoke("correct"),
  event: listen("stage"),
  localProgress: listen("local-progress"),
} as API;
contextBridge.exposeInMainWorld("subaudi", api);
