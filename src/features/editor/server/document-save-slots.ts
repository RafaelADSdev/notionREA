export class DocumentSaveBusyError extends Error {
  constructor() {
    super("Document save is busy");
    this.name = "DocumentSaveBusyError";
  }
}
// Bound the complete expensive save, including its database hex snapshot and
// main-thread byte copies. Worker-only limits start too late to bound those.
let active = 0;
const waiting: (() => void)[] = [];
export async function withDocumentSaveSlot<T>(save: () => Promise<T>): Promise<T> {
  if (active < 2) active++;
  else {
    if (waiting.length >= 8) throw new DocumentSaveBusyError();
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await save();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
