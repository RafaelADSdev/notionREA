import { type Extensions, Mark, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { z } from "zod";
import { createTranslator, DEFAULT_LOCALE, type Translator } from "@/lib/i18n/core";
import { contentToneSchema } from "../model/block-schema";
import { isSafeContentLink } from "../model/content-schema";

export type MentionResolver = {
  resolve(id: string): { title: string; href: string } | null;
  subscribe(listener: () => void): () => void;
};
export type MentionLocale = { translate: () => Translator; subscribe: (listener: () => void) => () => void };
export type TextExtensionOptions = { mentionResolver?: MentionResolver; locale?: MentionLocale };

const TextDocument = Node.create({ name: "doc", topNode: true, content: "paragraph" });

const SafeLink = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes() {
    return {
      href: {
        default: "",
        rendered: false,
        validate(value: unknown) {
          if (typeof value !== "string" || value.length > 4096 || !isSafeContentLink(value))
            throw new Error("Unsafe content link");
        },
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (element) => {
          const href = element.getAttribute("href") ?? "";
          return href.length <= 4096 && isSafeContentLink(href) ? { href } : false;
        },
      },
    ];
  },
  renderHTML({ mark }) {
    const href: unknown = mark.attrs.href;
    return typeof href === "string" && href.length <= 4096 && isSafeContentLink(href)
      ? ["a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, 0]
      : ["span", {}, 0];
  },
});

const SafeTextStyle = Mark.create({
  name: "textStyle",
  addAttributes() {
    return Object.fromEntries(
      ["color", "background"].map((name) => [
        name,
        {
          default: undefined,
          rendered: false,
          validate(value: unknown) {
            if (value !== undefined) contentToneSchema.parse(value);
          },
        },
      ]),
    );
  },
  parseHTML() {
    return [
      {
        tag: "span[data-content-color], span[data-content-background]",
        getAttrs: (element) => {
          const attrs: Record<string, string> = {};
          for (const name of ["color", "background"]) {
            const parsed = contentToneSchema.safeParse(element.getAttribute(`data-content-${name}`));
            if (parsed.success) attrs[name] = parsed.data;
          }
          return Object.keys(attrs).length ? attrs : false;
        },
      },
    ];
  },
  renderHTML({ mark }) {
    const attrs: Record<string, string> = {};
    for (const name of ["color", "background"]) {
      const parsed = contentToneSchema.safeParse(mark.attrs[name]);
      if (parsed.success) attrs[`data-content-${name}`] = parsed.data;
    }
    return ["span", attrs, 0];
  },
});

function safeMentionHref(href: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(href) || isSafeContentLink(href);
}

function pageMention(resolver?: MentionResolver, locale?: MentionLocale) {
  const translate = () => locale?.translate() ?? createTranslator(DEFAULT_LOCALE);
  return Node.create({
    name: "pageMention",
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        pageId: {
          default: "",
          rendered: false,
          validate(value: unknown) {
            z.uuid().parse(value);
          },
        },
      };
    },
    parseHTML() {
      return [
        {
          tag: "span[data-page-mention]",
          getAttrs: (element) => {
            const id = z.uuid().safeParse(element.getAttribute("data-page-mention"));
            return id.success ? { pageId: id.data } : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return ["span", { "data-page-mention": node.attrs.pageId }, translate()("editor.referencePage")];
    },
    renderText() {
      return translate()("editor.referencePage");
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("span");
        dom.contentEditable = "false";
        dom.className = "page-mention";
        let id = String(node.attrs.pageId);
        const render = () => {
          const value = resolver?.resolve(id);
          dom.replaceChildren();
          if (value && safeMentionHref(value.href)) {
            const link = document.createElement("a");
            link.textContent = value.title || translate()("pages.untitled");
            link.href = value.href;
            link.rel = "noopener noreferrer";
            dom.append(link);
          } else dom.textContent = translate()("editor.referenceUnavailable");
        };
        render();
        const unsubscribe = resolver?.subscribe(render);
        const unsubscribeLocale = locale?.subscribe(render);
        return {
          dom,
          update(next) {
            if (next.type.name !== "pageMention") return false;
            id = String(next.attrs.pageId);
            render();
            return true;
          },
          destroy() {
            unsubscribe?.();
            unsubscribeLocale?.();
          },
        };
      };
    },
  });
}

/** Outer block structure belongs to StablePage; this schema can never create a second paragraph. */
export function createTextExtensions(options: TextExtensionOptions = {}): Extensions {
  return [
    TextDocument,
    StarterKit.configure({
      document: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      heading: false,
      horizontalRule: false,
      codeBlock: false,
      undoRedo: false,
      link: false,
      trailingNode: false,
      gapcursor: false,
      dropcursor: false,
    }),
    SafeLink,
    SafeTextStyle,
    pageMention(options.mentionResolver, options.locale),
  ];
}
