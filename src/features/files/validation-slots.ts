// Shared by cover and block finalization. Reserve before Storage downloads and
// keep both the downloaded Blob and byte view bounded to two active validations.
let active = 0;
const waiting: (() => void)[] = [];
export async function withFileValidation<T>(task: () => Promise<T>): Promise<T> {
  if (active < 2) active++;
  else {
    if (waiting.length >= 8) throw new Error("Aguarde os envios em andamento e tente novamente.");
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
