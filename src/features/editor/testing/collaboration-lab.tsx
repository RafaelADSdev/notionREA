"use client";

import { useEffect, useRef } from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import * as Y from "yjs";
import { StablePage } from "../model/stable-page";
import { pageCollaboration } from "../model/page-collaboration";

type Controls = {
  pause(): void;
  resume(): void;
  move(): void;
  remove(): void;
  restore(): void;
  undo(): void;
};

// Isolated architectural fixture. BroadcastChannel is not the product transport.
export function CollaborationLab({ seed, session }: { seed: number[]; session: string }) {
  const host = useRef<HTMLDivElement>(null);
  const structure = useRef<HTMLOutputElement>(null);
  const connection = useRef<HTMLOutputElement>(null);
  const controls = useRef<Controls | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const document = new Y.Doc();
    Y.applyUpdate(document, Uint8Array.from(seed));
    const page = new StablePage(document, crypto.randomUUID());
    const channel = new BroadcastChannel(`bloco-lab-${session}`);
    let paused = false;
    const remote = Symbol("remote");
    const publish = () => {
      if (!paused) channel.postMessage(Y.encodeStateAsUpdate(document));
    };
    const render = () => {
      if (structure.current)
        structure.current.textContent = page
          .visibleChildren()
          .map(({ id }) => id)
          .join(",");
      if (connection.current) connection.current.textContent = paused ? "Pausado" : "Conectado";
    };
    const editor = new Editor({
      element: host.current,
      injectCSS: false,
      extensions: [StarterKit.configure({ undoRedo: false }), pageCollaboration(page, "subject")],
      editorProps: {
        attributes: { role: "textbox", "aria-label": "Texto de prova", "aria-multiline": "true" },
      },
    });
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      render();
      if (origin !== remote) publish();
    };
    document.on("update", onUpdate);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!paused && event.data instanceof Uint8Array && event.data.byteLength <= 1048576) {
        Y.applyUpdate(document, event.data, remote);
        page.validate();
      }
    };
    controls.current = {
      pause() {
        paused = true;
        render();
      },
      resume() {
        paused = false;
        render();
        publish();
      },
      move() {
        page.moveBlock("subject", null, "zz");
      },
      remove() {
        page.removeBlock("subject");
      },
      restore() {
        page.restoreBlock("subject");
      },
      undo() {
        page.undo();
      },
    };
    render();
    publish();
    return () => {
      controls.current = null;
      document.off("update", onUpdate);
      channel.close();
      editor.destroy();
      page.destroy();
      document.destroy();
    };
  }, [seed, session]);
  return (
    <main id="main" className="document">
      <h1>Prova isolada de colaboração</h1>
      <p>Dados sintéticos. Esta tela verifica o modelo; o editor de produto pertence ao M3.</p>
      <div className="form-stack">
        <button type="button" onClick={() => controls.current?.pause()}>
          Pausar troca
        </button>
        <button type="button" onClick={() => controls.current?.resume()}>
          Retomar troca
        </button>
        <button type="button" onClick={() => controls.current?.move()}>
          Mover ao fim
        </button>
        <button type="button" onClick={() => controls.current?.remove()}>
          Ocultar bloco
        </button>
        <button type="button" onClick={() => controls.current?.restore()}>
          Restaurar bloco
        </button>
        <button type="button" onClick={() => controls.current?.undo()}>
          Desfazer local
        </button>
        <output aria-label="Conexão" ref={connection} />
        <output aria-label="Ordem visível" ref={structure} />
        <div ref={host} />
      </div>
    </main>
  );
}
