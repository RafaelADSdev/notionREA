export type PageFileInfo = {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
};
export type BlockFileResolver = {
  resolve(id: string): PageFileInfo | null;
  subscribe(listener: () => void): () => void;
  ensure(id: string): void;
  prime(info: PageFileInfo): void;
};
