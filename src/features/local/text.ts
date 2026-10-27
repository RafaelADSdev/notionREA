import type { Locale } from "@/lib/i18n/core";
const messages = {
  local: ["Neste navegador", "In this browser"],
  pages: ["Páginas", "Pages"],
  newPage: ["Nova página", "New page"],
  newChild: ["Criar subpágina", "Create subpage"],
  search: ["Buscar páginas", "Search pages"],
  all: ["Todas", "All"],
  favorites: ["Favoritas", "Favorites"],
  trash: ["Lixeira", "Trash"],
  untitled: ["Sem título", "Untitled"],
  title: ["Título da página", "Page title"],
  icon: ["Ícone da página", "Page icon"],
  parent: ["Mover para", "Move to"],
  root: ["Raiz do espaço", "Workspace root"],
  favorite: ["Favoritar", "Add favorite"],
  unfavorite: ["Remover favorito", "Remove favorite"],
  moveUp: ["Mover página para cima", "Move page up"],
  moveDown: ["Mover página para baixo", "Move page down"],
  archive: ["Mover para lixeira", "Move to trash"],
  restore: ["Restaurar página", "Restore page"],
  empty: ["Seu próximo texto começa aqui.", "Your next story starts here."],
  emptyBody: [
    "Crie uma página e comece a escrever. Tudo fica salvo neste navegador.",
    "Create a page and start writing. Everything is saved in this browser.",
  ],
  emptyList: ["Nenhuma página aqui.", "No pages here."],
  backup: ["Baixar backup", "Download backup"],
  import: ["Restaurar backup", "Restore backup"],
  backupDone: [
    "Backup baixado. Guarde o arquivo em um lugar seguro.",
    "Backup downloaded. Keep the file somewhere safe.",
  ],
  importDone: [
    "Páginas ausentes restauradas. As notas existentes foram preservadas.",
    "Missing pages restored. Existing notes were preserved.",
  ],
  importFailed: [
    "O backup é inválido, incompatível ou excede 32 MiB. Nenhuma nota foi substituída.",
    "The backup is invalid, incompatible or exceeds 32 MiB. No note was replaced.",
  ],
  saveFailed: [
    "Não foi possível salvar no navegador. Seu texto aberto foi preservado. Tente novamente antes de sair.",
    "The browser could not save your change. Your open text was preserved. Try again before leaving.",
  ],
  openFailed: [
    "Não foi possível abrir o armazenamento deste navegador. Verifique se os dados do site estão permitidos.",
    "This browser's storage could not be opened. Check whether site data is allowed.",
  ],
  retry: ["Tentar novamente", "Try again"],
  loading: ["Abrindo seu espaço local…", "Opening your local workspace…"],
  privacy: [
    "Suas notas ficam neste dispositivo. Limpar os dados do site pode apagá-las. Faça backups.",
    "Your notes stay on this device. Clearing site data can erase them. Make backups.",
  ],
  menu: ["Abrir páginas", "Open pages"],
  close: ["Fechar páginas", "Close pages"],
  theme: ["Alternar tema", "Change theme"],
  language: ["Idioma", "Language"],
  unsaved: [
    "Aguarde o salvamento ou tente novamente antes de trocar de página.",
    "Wait for saving or retry before switching pages.",
  ],
} as const satisfies Record<string, readonly [string, string]>;
export type LocalText = (key: keyof typeof messages) => string;
export function localText(locale: Locale): LocalText {
  return (key) => messages[key][locale === "en" ? 1 : 0];
}
